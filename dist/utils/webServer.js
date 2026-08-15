// ============================================================
//  Guang Code — Built-in Web UI Server (zero-dependency)
//  - HTTP (Node native http module)
//  - SDK interop: /sdk/v1 POST jsonrpc/ndjson + /sdk/v1/sse
//  - Web UI static: single-file SPA at dist/ui/index.html
//  - Convenience REST: /api/ui/* for listSessions / skills / plugins
// ============================================================
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { createSdkServer, createHttpNdjsonHandler, createSseHandler, InProcessServerTransport } from './sdkInterop.js';
import { sessionStore } from './sessionES.js';
import { skills as skillLoader } from './skillLoader.js';
import { pluginManager } from './pluginManager.js';
import { compactionRegistry } from './compaction.js';
import { runQuery } from './QueryEngine.js';
import { loadConfig } from './config.js';
import { randomUUID } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

export class GuangWebServer extends EventEmitter {
  constructor(opts) {
    super();
    this.cwd = opts?.cwd ?? process.cwd();
    this.uiDir = opts?.uiDir ?? path.resolve(__dirname, '..', 'ui');
    this.port = opts?.port ?? 5173;
    this.host = opts?.host ?? '127.0.0.1';
    this.server = null;
    this.sdkServer = null;
    this.ndjsonHandler = null;
    this.sseHandler = null;
    this._started = false;
    this._sdkMethodId = 0;
    this._setupSdk();
    this._setupServer();
  }

  _setupSdk() {
    const self = this;
    this.sdkServer = createSdkServer({
      getTools: () => {
        try {
          const mod = (typeof globalThis.__guangTools !== 'undefined') ? globalThis.__guangTools : [];
          if (Array.isArray(mod) && mod.length) return mod;
        } catch {}
        const builtin = [
          { name: 'noop', description: 'Test echo', inputSchema: { type: 'object', properties: { value: { type: 'string' } } }, execute: async (i) => ({ content: JSON.stringify({ value: i.value ?? 'ok' }) }) },
          { name: 'ping', description: 'Ping server', inputSchema: { type: 'object' }, execute: async () => ({ content: 'pong', t: Date.now() }) },
          { name: 'list_sessions', description: 'List sessions', inputSchema: { type: 'object', properties: { limit: { type: 'number' } } }, execute: async ({ limit }) => ({ content: JSON.stringify(await sessionStore.listSessions(limit)) }) },
          { name: 'list_plugins', description: 'List all plugins', execute: async () => ({ content: JSON.stringify(pluginManager.listPlugins?.() ?? Array.from((pluginManager.plugins ?? new Map()).values())) }) },
          { name: 'list_skills', description: 'List skills (scope:builtin/global/project/session/runtime)', inputSchema: { type: 'object', properties: { scope: { type: 'string' }, search: { type: 'string' } } }, execute: async ({ scope, search }) => ({ content: JSON.stringify(skillLoader.list({ scope, search })) }) },
        ];
        try {
          const { builtInTools } = Object.hasOwn(globalThis, '__guangRequire')
            ? globalThis.__guangRequire('./tools/index.js')
            : (typeof require !== 'undefined' ? require('./tools/index.js') : { builtInTools: [] });
          if (Array.isArray(builtInTools)) return [...builtin, ...builtInTools];
        } catch {}
        return builtin;
      },
      session: {
        listSessions: async ({ limit }) => await sessionStore.listSessions(limit),
        readEvents: async (sessionId, fromSeq, limit) => await sessionStore.readEvents(sessionId, fromSeq, limit),
        getProjection: async (sessionId) => await sessionStore.getProjection(sessionId),
      },
      skills: skillLoader,
      plugins: {
        list: () => pluginManager.listPlugins?.() ?? Array.from((pluginManager.plugins ?? new Map()).values()),
        propose: async (source, meta) => await pluginManager.propose(source, meta),
        approval: {
          decide: async (rid, decision, by, extra) => await pluginManager.approval.decide(rid, decision, by, extra),
          listPending: () => pluginManager.approval.listPending?.() ?? [],
        },
      },
      memoryBackend: (() => {
        try {
          const { memoryRegistry } = require('./memoryRegistry.js');
          return memoryRegistry?.defaultBackend ?? memoryRegistry;
        } catch { return null; }
      })(),
    });
    this.ndjsonHandler = createHttpNdjsonHandler(this.sdkServer);
    this.sseHandler = createSseHandler(this.sdkServer, { path: '/sdk/v1/sse' });
    this.sdkServer.on('acp-publish', ({ topic, payload }) => {
      self.emit('acp-publish', { topic, payload });
    });
  }

  _setupServer() {
    const self = this;
    this.server = http.createServer(async (req, res) => {
      try { await self._route(req, res); }
      catch (err) {
        console.error('[webui] route error:', err);
        try { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message || String(err) })); } catch {}
      }
    });
    this.server.on('listening', () => { this._started = true; this.emit('listening', { port: this.port, host: this.host }); });
    this.server.on('close', () => { this._started = false; this.emit('close'); });
  }

  async start(port, host) {
    if (port) this.port = port;
    if (host) this.host = host;
    return new Promise((resolve, reject) => {
      const onErr = (e) => reject(e);
      this.server.once('error', onErr);
      this.server.listen(this.port, this.host, () => {
        this.server.off('error', onErr);
        resolve({ url: `http://${this.host}:${this.port}`, port: this.port, host: this.host });
      });
    });
  }

  async stop() {
    return new Promise((resolve, reject) => {
      if (!this.server || !this._started) { resolve(); return; }
      this.server.close((err) => err ? reject(err) : resolve());
    });
  }

  getUrl() { return `http://${this.host}:${this.port}`; }
  isRunning() { return this._started; }

  // --- Router --------------------------------------------------------
  async _route(req, res) {
    const url = new URL(req.url, `${this.getUrl()}`);
    const p = url.pathname;
    // SDK POST: /sdk/v1 (ndjson stream)
    if (req.method === 'POST' && (p === '/sdk/v1' || p === '/sdk/v1/jsonrpc' || p === '/sdk')) {
      await this.ndjsonHandler(req, res);
      return;
    }
    // SDK SSE: /sdk/v1/sse
    if (req.method === 'GET' && p === '/sdk/v1/sse') {
      this.sseHandler(req, res);
      return;
    }
    // Convenience REST (JSON, for web UI to call without JSON-RPC wrapping)
    if (p.startsWith('/api/ui/')) {
      const tail = p.slice('/api/ui/'.length);
      if (tail === 'chat' && req.method === 'POST') {
        await this._chatStream(req, res);
        return;
      }
      await this._restApi(req, res, tail, url);
      return;
    }
    // Static web UI (single-page app, fallback all unknown GET to index.html)
    if (req.method === 'GET') {
      await this._serveStatic(p, res);
      return;
    }
    res.writeHead(404); res.end('Not Found');
  }

  // --- Chat streaming (QueryEngine.runQuery → SSE events to browser) -------------
  async _chatStream(req, res) {
    let body = {};
    try { body = await this._readBodyJson(req); } catch (e) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Invalid JSON body: ' + e.message);
    }
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: 'message is required (string)' }));
    }
    // Load existing session messages if sessionId provided, otherwise start fresh
    const sessionId = body.sessionId || ('webui-' + randomUUID().slice(0, 12));
    let messages = [];
    if (Array.isArray(body.messages) && body.messages.length) messages = body.messages.slice();
    else if (body.sessionId) {
      try {
        const proj = await sessionStore.getProjection(sessionId);
        messages = Array.isArray(proj?.messages) ? proj.messages.slice() : [];
      } catch { messages = []; }
    }
    messages.push({ role: 'user', content: message, createdAt: Date.now() });

    // Determine model + config
    const cfg = await loadConfig().catch(() => null);
    const model = body.model || cfg?.defaultModel || 'deepseek-chat';
    const cwd = body.cwd || this.cwd || process.cwd();

    // SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const sendEvt = (type, data) => {
      try { res.write('event: ' + type + '\ndata: ' + JSON.stringify(data ?? {}) + '\n\n'); } catch {}
    };

    // Helper: build assistant message incrementally on the fly (server side)
    const assistantMsg = { role: 'assistant', content: '', createdAt: Date.now(), toolCalls: [] };
    const idMap = new Map(); // tool_call_start local id -> toolCalls index

    sendEvt('session', { sessionId });
    sendEvt('user_message', { role: 'user', content: message });

    const onStreamChunk = (chunk) => {
      switch (chunk.type) {
        case 'text_delta':
          assistantMsg.content += chunk.text;
          sendEvt('text_delta', { text: chunk.text });
          break;
        case 'tool_start':
          sendEvt('tool_start', { toolName: chunk.toolName, id: chunk.id });
          if (chunk.id && !idMap.has(chunk.id)) {
            const tc = { id: chunk.id, name: chunk.toolName, input: {}, result: '' };
            assistantMsg.toolCalls.push(tc);
            idMap.set(chunk.id, assistantMsg.toolCalls.length - 1);
          }
          break;
        case 'tool_done': {
          sendEvt('tool_done', {
            toolName: chunk.toolName,
            id: chunk.id,
            toolResult: chunk.toolResult,
            isError: !!chunk.isError,
          });
          if (chunk.id && idMap.has(chunk.id)) {
            assistantMsg.toolCalls[idMap.get(chunk.id)].result = chunk.toolResult ?? '';
            assistantMsg.toolCalls[idMap.get(chunk.id)].isError = !!chunk.isError;
          }
          break;
        }
        case 'error':
          sendEvt('error', { error: chunk.error || String(chunk) });
          break;
        case 'done':
          sendEvt('done', {
            inputTokens: chunk.inputTokens || 0,
            outputTokens: chunk.outputTokens || 0,
          });
          break;
      }
    };

    try {
      const opts = {
        messages,
        model,
        cwd,
        sessionId,
        permissionMode: cfg?.permissionMode || 'confirm_high_risk',
        providerConfig: cfg || undefined,
        apiKeyOverride: body.apiKey || undefined,
        onStreamChunk,
        onPermissionRequest: async (reqInfo) => {
          sendEvt('permission_request', reqInfo);
          // Web UI default: deny bash/high-risk on first run to be safe
          const highRisk = (reqInfo.tool || '').toLowerCase().match(/bash|write|delete|remove|sendmessage|agenttool/);
          return { effect: highRisk ? 'deny' : 'allow', reason: 'web-ui default policy (deny destructive actions on first run)' };
        },
      };
      const result = await runQuery(opts);
      // If query finished but no done was emitted yet
      sendEvt('final', {
        sessionId,
        messages: result.messages || [assistantMsg],
        inputTokens: result.inputTokens || 0,
        outputTokens: result.outputTokens || 0,
      });
    } catch (e) {
      sendEvt('error', { error: e.message || String(e), stack: e.stack });
      sendEvt('final', { sessionId, error: e.message || String(e) });
    } finally {
      try { res.end(); } catch {}
    }
  }

  async _restApi(req, res, tail, url) {
    const segs = tail.split('/').filter(Boolean);
    const [resource, id, sub] = segs;
    const json = (body, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
    try {
      // sessions
      if (resource === 'sessions' && segs.length === 1) {
        const limit = parseInt(url.searchParams.get('limit') || '50', 10);
        return json({ sessions: await sessionStore.listSessions(limit) });
      }
      if (resource === 'sessions' && id && !sub) {
        const [proj, events] = await Promise.all([sessionStore.getProjection(id), sessionStore.readEvents(id)]);
        return json({ projection: proj, events });
      }
      if (resource === 'sessions' && id && sub === 'events') {
        const from = parseInt(url.searchParams.get('from') || '1', 10);
        return json({ events: await sessionStore.readEvents(id, from) });
      }
      // skills
      if (resource === 'skills') {
        const scope = url.searchParams.get('scope') || undefined;
        const search = url.searchParams.get('search') || undefined;
        return json({ skills: skillLoader.list({ scope, search }) });
      }
      if (resource === 'skills' && id === 'inject' && req.method === 'POST') {
        const body = await this._readBodyJson(req);
        const result = skillLoader.inject(body.markdown, { id: body.id, scope: body.scope || 'runtime' });
        return json({ ok: true, skill: result });
      }
      // plugins
      if (resource === 'plugins' && segs.length === 1) {
        const list = pluginManager.list?.() ?? Array.from((pluginManager.plugins ?? new Map()).values());
        const pending = pluginManager.approval?.listPending?.() ?? [];
        return json({ plugins: list, pending, models: pluginManager.APPROVAL_MODELS || ['none','user_confirm','llm_vote','user_and_llm'] });
      }
      if (resource === 'plugins' && id === 'propose' && req.method === 'POST') {
        const body = await this._readBodyJson(req);
        const proposal = await pluginManager.propose(body.source, body.meta || {});
        return json({ ok: true, proposal });
      }
      if (resource === 'plugins' && sub === 'approve' && req.method === 'POST') {
        const by = 'web-user';
        const approved = await pluginManager.approval.decide(id, 'approve', by, { comment: 'Web UI approval' });
        return json({ ok: true, result: approved });
      }
      if (resource === 'plugins' && sub === 'deny' && req.method === 'POST') {
        const body = await this._readBodyJson(req).catch(() => ({}));
        const by = 'web-user';
        const denied = await pluginManager.approval.decide(id, 'deny', by, { comment: body?.comment || 'Web UI denied' });
        return json({ ok: true, result: denied });
      }
      // compaction strategies
      if (resource === 'compaction') {
        const def = compactionRegistry.defaultName;
        const list = compactionRegistry.list();
        // Build usage from internal _usage Map
        const usage = [];
        if (compactionRegistry._usage && typeof compactionRegistry._usage.forEach === 'function') {
          compactionRegistry._usage.forEach((v, k) => usage.push({ strategy: k, count: v }));
        }
        return json({ default: def, strategies: list, usage });
      }
      // sdk info
      if (resource === 'sdk-info') {
        const jrpc = await this._sdkCall('sdk.info');
        const tl = await this._sdkCall('tools/list');
        const ping = { jsonrpc: '2.0', t: Date.now() };
        return json({ info: jrpc, tools: tl, health: ping, url: this.getUrl() });
      }
      return json({ error: 'Unknown rest endpoint', path: tail }, 404);
    } catch (e) {
      return json({ error: e.message || String(e), stack: e.stack }, 500);
    }
  }

  async _sdkCall(method, params) {
    const id = ++this._sdkMethodId;
    return new Promise((resolve, reject) => {
      const tp = new InProcessServerTransport();
      tp.open = true;
      let received = false;
      tp.on('out', (m) => {
        if (received) return;
        if (m && m.id !== id) return;
        received = true;
        if (m?.error) reject(Object.assign(new Error(m.error.message || String(m.error)), { code: m.error.code, data: m.error.data }));
        else resolve(m?.result);
      });
      tp.on('close', () => {
        if (!received) setTimeout(() => { if (!received) reject(new Error('SDK internal call closed without response')); }, 20);
      });
      this.sdkServer.attachTransport(tp, 'jsonrpc');
      tp.emit('message', { jsonrpc: '2.0', id, method, params: params ?? {} });
      setTimeout(() => { if (!received) reject(new Error('SDK internal call timeout')); }, 8000);
    });
  }

  async _readBodyJson(req) {
    let s = '';
    for await (const c of req) s += c.toString('utf8');
    return s ? JSON.parse(s) : {};
  }

  async _serveStatic(origPath, res) {
    let fp = origPath === '/' ? '/index.html' : origPath;
    // sanitize: prevent path traversal
    fp = path.normalize(fp).replace(/^(\.\.(\/|\\|$))+/, '');
    const filePath = path.join(this.uiDir, fp);
    try {
      const st = await fs.promises.stat(filePath).catch(() => null);
      if (st && st.isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        fs.createReadStream(filePath).pipe(res);
        return;
      }
    } catch {}
    // fallback: index.html (SPA routing)
    const idx = path.join(this.uiDir, 'index.html');
    try {
      await fs.promises.access(idx);
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      fs.createReadStream(idx).pipe(res);
      return;
    } catch {
      res.writeHead(404); res.end('UI dist/ui/index.html not found. Please build the web-ui first.');
    }
  }
}

export let webServer = null;

export async function startWebServer(opts) {
  if (webServer && webServer.isRunning()) {
    return { url: webServer.getUrl(), existing: true, port: webServer.port };
  }
  webServer = new GuangWebServer(opts);
  const addr = await webServer.start(opts?.port, opts?.host);
  return { ...addr, existing: false };
}

export async function stopWebServer() {
  if (!webServer) return { ok: true, wasRunning: false };
  const wasRunning = webServer.isRunning();
  await webServer.stop();
  return { ok: true, wasRunning };
}

export function getWebServer() { return webServer; }
