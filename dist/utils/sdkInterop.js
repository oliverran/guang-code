// ============================================================
//  Guang Code — SDK for external interop
//  Protocols:
//    - MCP (Model Context Protocol):  StreamableHTTP / SSE / Stdio
//    - ACP (Agent Communication Protocol, lightweight): JSON-RPC 2.0 + SSE + PubSub
//    - Plain JSON-RPC 2.0: HTTP POST + streaming via NDJSON + chunked
//  Exports:
//    createSdkServer(opts)   —   Embedded server (listener registration)
//    createSdkClient(transportCfg)   —   Universal client (works against any of the 3)
//    buildToolsSchema(getToolsFn) —   discoverability / OpenAPI-like JSON schema
// ============================================================
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';

const JSONRPC_VERSION = '2.0';

// ---- Type shortcuts --------------------------------------------------
function isStr(v) { return typeof v === 'string'; }
function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function jrpcOk(id, result) { return { jsonrpc: JSONRPC_VERSION, id, result }; }
function jrpcErr(id, code, message, data) { return { jsonrpc: JSONRPC_VERSION, id, error: { code, message, data } }; }
function jrpcNotif(method, params) { return { jsonrpc: JSONRPC_VERSION, method, params }; }

// ---- Transport abstractions (both server & client reuse) ------------
/** Transport lifecycle: open → onmessage / send / close */
class TransportBase extends EventEmitter {
  constructor() { super(); this.open = false; }
  send(_msg) { throw new Error('send not implemented'); }
  close() { this.open = false; this.emit('close'); }
}

// ─────────────────────────────────────────────────────────────────────
// Server-side transports (in-process — caller wires them to their HTTP server)
// ─────────────────────────────────────────────────────────────────────
export class InProcessServerTransport extends TransportBase {
  constructor() { super(); this.open = true; this.outbox = []; }
  send(msg) { this.emit('out', msg); this.outbox.push(msg); }
  inject(msg) { this.emit('message', msg); }
}

/** NDJSON over chunked HTTP (both JSON-RPC/ACP/MCP streamable-http) */
export function createHttpNdjsonHandler(sdkServer) {
  return async function ndjsonHandler(req, res) {
    const tp = new InProcessServerTransport();
    sdkServer.attachTransport(tp, detectProtocolFromHeaders(req.headers));
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache');
    res.flushHeaders?.();
    tp.on('out', (msg) => { try { res.write(JSON.stringify(msg) + '\n'); } catch { try { res.end(); } catch {} } });
    tp.on('close', () => { try { res.end(); } catch {} });
    // Collect request body (can be a single JSON-RPC request or NDJSON array)
    let chunks = '';
    for await (const chunk of (req.bodyStream ?? (async function* () {
      if (req.on) {
        for await (const c of req) yield c;
      }
    })())) {
      chunks += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    }
    const lines = chunks.split('\n').map(l => l.trim()).filter(Boolean);
    try {
      for (const line of lines) tp.inject(JSON.parse(line));
    } catch (e) {
      res.write(JSON.stringify(jrpcErr(null, -32700, 'Parse error: ' + e.message)) + '\n');
    } finally {
      // Wait briefly for streaming responses to emit
      setTimeout(() => { try { tp.close(); } catch {} }, 150);
    }
  };
}

/** SSE handler (for subscriptions — ACP pubsub / MCP notifications) */
export function createSseHandler(sdkServer, opts) {
  const { path = '/sse' } = opts ?? {};
  return function sseHandler(req, res) {
    const tp = new InProcessServerTransport();
    sdkServer.attachTransport(tp, detectProtocolFromHeaders(req.headers));
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    tp.on('out', (msg) => { res.write('data: ' + JSON.stringify(msg) + '\n\n'); });
    req.once('close', () => { try { tp.close(); } catch {} });
    // Hand back a send-function for request side: SSE is server-push only, we return an injector.
    return { injector: (msg) => tp.inject(msg), close: () => tp.close() };
  };
}

function detectProtocolFromHeaders(headers) {
  if (!headers) return 'jsonrpc';
  const accept = (headers.accept || '').toLowerCase();
  const contentType = (headers['content-type'] || '').toLowerCase();
  if (accept.includes('application/mcp+json') || contentType.includes('application/mcp+json')) return 'mcp';
  if (accept.includes('application/acp+json') || contentType.includes('application/acp+json')) return 'acp';
  return 'jsonrpc';
}

// ─────────────────────────────────────────────────────────────────────
// Client-side transports
// ─────────────────────────────────────────────────────────────────────
export class StdioClientTransport extends TransportBase {
  constructor(opts) {
    super(); this.opts = opts ?? {}; this.proc = null;
  }
  async open() {
    const { command, args, env } = this.opts;
    this.proc = spawn(command, args ?? [], { env: { ...process.env, ...(env ?? {}) }, stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32' });
    this.open = true;
    this.proc.stdout.on('data', (buf) => this._decode(buf));
    this.proc.stderr.on('data', (_buf) => { /* ignore server stderr logs, but keep pipe drained */ });
    this.proc.once('exit', () => { this.open = false; this.emit('close'); });
  }
  _decode(buf) {
    const txt = buf.toString('utf8');
    for (const line of txt.split('\n').map(l => l.trim()).filter(Boolean)) {
      try { this.emit('message', JSON.parse(line)); }
      catch { this.emit('parseError', { raw: line }); }
    }
  }
  send(msg) {
    if (!this.proc || !this.open) throw new Error('Stdio transport not open');
    this.proc.stdin.write(JSON.stringify(msg) + '\n');
  }
  close() {
    try { this.proc?.stdin?.end(); } catch {}
    try { this.proc?.kill('SIGTERM'); } catch {}
    super.close();
  }
}

export class HttpClientTransport extends TransportBase {
  constructor(url, opts) {
    super(); this.url = url; this.headers = opts?.headers ?? {}; this.protocol = opts?.protocol ?? 'detect'; this.open = true;
  }
  async open() { this.open = true; }
  send(msg) { throw new Error('Use request() for HTTP transports, send() is for streams.'); }
  async request(body, opts) {
    const fetchFn = globalThis.fetch ?? await import('node-fetch').then(m => m.default ?? m);
    if (typeof fetchFn !== 'function') throw new Error('No fetch available');
    const resp = await fetchFn(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: this._acceptHeader(), ...(this.headers ?? {}) },
      body: JSON.stringify(body),
      signal: opts?.signal ?? undefined,
    });
    const ct = resp.headers.get('Content-Type') ?? '';
    if (ct.includes('ndjson') || opts?.stream) {
      // stream back NDJSON
      const self = this;
      return (async function* () {
        const reader = resp.body.getReader();
        let buf = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) return;
          buf += new TextDecoder('utf-8').decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const l of lines) if (l.trim()) yield JSON.parse(l);
        }
      })();
    }
    return resp.json();
  }
  _acceptHeader() {
    if (this.protocol === 'mcp')     return 'application/mcp+json, application/x-ndjson; q=0.9';
    if (this.protocol === 'acp')     return 'application/acp+json, application/x-ndjson; q=0.9';
    return 'application/json, application/x-ndjson; q=0.7';
  }
  close() { super.close(); }
}

export class SseClientTransport extends TransportBase {
  constructor(url, opts) { super(); this.url = url; this.headers = opts?.headers ?? {}; this.es = null; this.open = false; }
  async open() {
    const EventSource = (globalThis.EventSource) ?? (await import('eventsource')).default ?? (await import('eventsource'));
    if (!EventSource) throw new Error('No EventSource (SSE) implementation available');
    this.es = new EventSource(this.url, { headers: this.headers, withCredentials: false });
    this.open = true;
    this.es.addEventListener('message', (ev) => {
      try { this.emit('message', JSON.parse(ev.data)); } catch { this.emit('parseError', ev.data); }
    });
    this.es.addEventListener('open', () => this.emit('open'));
    this.es.addEventListener('error', (e) => this.emit('error', e));
  }
  send(_msg) { throw new Error('SSE client is read-only from server; pair with HttpClientTransport for requests'); }
  close() { try { this.es?.close(); } catch {} super.close(); }
}

// ─────────────────────────────────────────────────────────────────────
// Schema builder (discovery endpoints)
// ─────────────────────────────────────────────────────────────────────
export function buildToolsSchema(getToolsFn) {
  const tools = Array.from((typeof getToolsFn === 'function' ? getToolsFn() : getToolsFn) ?? []);
  return {
    schemaVersion: 1,
    generatedAt: Date.now(),
    toolCount: tools.length,
    tools: tools.map(t => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
      tags: t.tags ?? [],
      timeoutMs: t.timeoutMs ?? 180_000,
      requiresAuth: !!t.requiresAuth,
      protocolHints: ['jsonrpc', 'acp', 'mcp'],
    })),
  };
}

export function buildMemorySchema(backendName, capabilities) {
  return {
    schemaVersion: 1,
    backend: backendName ?? 'hybrid',
    capabilities: capabilities ?? { add: true, remove: true, search: true, list: true },
  };
}

export function buildSessionSchema() {
  return {
    schemaVersion: 1,
    eventTypes: [
      'SessionCreated','SessionMetadataChanged','SessionArchived','SessionForked',
      'MessageAdded','MessageRemoved','MessageEdited','MessagesTrimmed',
      'ToolCallInitiated','ToolCallCompleted','ToolCallFailed',
      'ToolPermissionGranted','ToolPermissionDenied',
      'SkillInvoked','SkillCompleted','MemoryWritten','MemoryQueried','MemoryRemoved',
      'HookTriggered','HookFailed','BudgetExceeded','SessionCompleted',
    ],
    compactionStrategies: ['keep_last','summary_inject','summary_llm','hybrid'],
    approvalModels: ['none','user_confirm','llm_vote','user_and_llm'],
  };
}

// ─────────────────────────────────────────────────────────────────────
// SdkServer: registers capabilities once, handles 3 protocols by
// dispatching each JSON-RPC-like envelope to the right handler.
// ─────────────────────────────────────────────────────────────────────
export class SdkServer extends EventEmitter {
  constructor(opts) {
    super();
    this.handlers = new Map();
    this.subscriptions = new Map(); // topic -> Set<transport>
    this.toolsGetter = opts?.getTools ?? (() => []);
    this.memoryGetter = opts?.memoryBackend ?? null;
    this.sessionGetter = opts?.session ?? null;
    this.pluginGetter = opts?.plugins ?? null;
    this.skillGetter = opts?.skills ?? null;
    this.protocolOverrides = opts?.protocolOverrides ?? {}; // path -> protocol
    this._registerDefaultHandlers();
  }

  // -------- handlers --------------------------------------------------
  register(method, handler) {
    this.handlers.set(method, handler);
    return () => this.handlers.delete(method);
  }

  _registerDefaultHandlers() {
    // JSON-RPC / ACP / MCP common methods — each handler returns {value, isStream?}
    this.register('tools/list', () => buildToolsSchema(this.toolsGetter));
    this.register('tools/schema', ({ name }) => {
      const all = this.toolsGetter();
      const t = all.find(x => x.name === name);
      if (!t) throw Object.assign(new Error(`Tool not found: ${name}`), { code: -32602 });
      return { name: t.name, description: t.description ?? '', inputSchema: t.inputSchema ?? {} };
    });
    this.register('tools/call', async ({ name, arguments: args, meta }, ctx) => {
      const all = typeof this.toolsGetter === 'function' ? this.toolsGetter() : this.toolsGetter;
      const t = Array.from(all).find(x => x.name === name);
      if (!t) throw Object.assign(new Error(`Tool not found: ${name}`), { code: -32601 });
      const input = args ?? {};
      const c = { sessionId: meta?.sessionId ?? null, cwd: meta?.cwd ?? process.cwd() };
      return await t.execute(input, c);
    });
    // Memory
    this.register('memory/list', ({ limit, type }) => {
      if (!this.memoryGetter) throw Object.assign(new Error('Memory backend not configured'), { code: -32001 });
      return this.memoryGetter.listEntries?.({ limit, type }) ?? [];
    });
    this.register('memory/add', ({ entry }) => {
      if (!this.memoryGetter) throw Object.assign(new Error('Memory backend not configured'), { code: -32001 });
      return this.memoryGetter.addEntry?.(entry) ?? { ok: false };
    });
    this.register('memory/search', ({ query, limit }) => {
      if (!this.memoryGetter) throw Object.assign(new Error('Memory backend not configured'), { code: -32001 });
      return this.memoryGetter.searchEntries?.(query, { limit }) ?? [];
    });
    this.register('memory/schema', () => buildMemorySchema(this.memoryGetter?.backendName, this.memoryGetter?.capabilities));
    // Session
    this.register('session/schema', () => buildSessionSchema());
    this.register('session/events', ({ sessionId, fromSeq, limit }) => this.sessionGetter?.readEvents?.(sessionId, fromSeq, limit) ?? []);
    this.register('session/projection', ({ sessionId }) => this.sessionGetter?.getProjection?.(sessionId) ?? null);
    this.register('session/list', ({ limit }) => this.sessionGetter?.listSessions?.({ limit }) ?? []);
    // Skills
    this.register('skills/list', ({ scope, search }) => this.skillGetter?.list?.({ scope, search }) ?? []);
    this.register('skills/inject', ({ id, markdown, scope }) => this.skillGetter?.inject?.(markdown, { id, scope }) ?? null);
    // Plugins
    this.register('plugins/list', () => this.pluginGetter?.list?.() ?? []);
    this.register('plugins/propose', ({ source }) => this.pluginGetter?.propose?.(source) ?? null);
    this.register('plugins/approval/decide', ({ requestId, decision, by }) => this.pluginGetter?.approval?.decide?.(requestId, decision, by) ?? null);
    // PubSub (ACP)
    this.register('acp.subscribe', async ({ topic }, ctx) => {
      if (!ctx.transport) return { ok: false, error: 'no transport context' };
      if (!this.subscriptions.has(topic)) this.subscriptions.set(topic, new Set());
      this.subscriptions.get(topic).add(ctx.transport);
      return { ok: true, topic, subscribers: this.subscriptions.get(topic).size };
    });
    this.register('acp.unsubscribe', async ({ topic }, ctx) => {
      this.subscriptions.get(topic)?.delete(ctx.transport);
      return { ok: true };
    });
    this.register('acp/publish', ({ topic, payload }) => this.publish(topic, payload));
    // Discovery / meta
    this.register('sdk.info', async () => {
      let config = {};
      try {
        const mod = await import('./config.js');
        config = (await (mod.loadConfig?.())) || {};
      } catch { config = {}; }
      return {
        name: 'guang-code-sdk',
        version: '1.0.0',
        protocols: ['jsonrpc','acp','mcp'],
        capabilities: { tools: true, memory: !!this.memoryGetter, session: !!this.sessionGetter, skills: !!this.skillGetter, plugins: !!this.pluginGetter, pubsub: true },
        endpoints: {
          httpPost: '/sdk/v1',
          sse: '/sdk/v1/sse',
          ndjson: '/sdk/v1/stream',
          chat: '/api/ui/chat',
        },
        defaultModel: config?.defaultModel || 'deepseek-chat',
        config,
      };
    });
    // MCP initialization handshake
    this.register('initialize', ({ protocolVersion, capabilities, clientInfo }) => ({
      protocolVersion: protocolVersion ?? '2024-11-05',
      capabilities: {
        tools: { listChanged: true },
        logging: {},
        roots: { listChanged: false },
        acp: { pubsub: true },
      },
      serverInfo: { name: 'guang-code', version: '1.0.0' },
    }));
    this.register('notifications/initialized', () => ({ ok: true }));
    this.register('tools/list_mcp', () => ({ tools: buildToolsSchema(this.toolsGetter).tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) }));
    this.register('tools/call_mcp', ({ name, arguments: args }) => this.handlers.get('tools/call')({ name, arguments: args }));
  }

  // Lifecycle
  attachTransport(transport, protocolHint) {
    transport.protocol = protocolHint ?? 'jsonrpc';
    transport.on('message', async (envelope) => this._dispatch(envelope, transport));
  }

  async _dispatch(envelope, transport) {
    const ctx = { transport, protocol: transport.protocol ?? 'jsonrpc' };
    // Array = batch
    if (Array.isArray(envelope)) {
      const outs = [];
      for (const e of envelope) {
        const r = await this._handleOne(e, ctx);
        if (r) outs.push(r);
      }
      if (outs.length) transport.send(outs);
      return;
    }
    const r = await this._handleOne(envelope, ctx);
    if (r) transport.send(r);
  }

  async _handleOne(envelope, ctx) {
    // Notification: JSON-RPC no id
    const isNotification = !('id' in envelope);
    // MCP wraps into jsonrpc, ACP uses method directly; all share same shape {method, params}
    let method = envelope.method;
    let params = envelope.params ?? {};
    // MCP 'tools/list' aliasing
    if (method === 'tools/list' && ctx.protocol === 'mcp') {
      method = 'tools/list_mcp';
      params = params ?? {};
    }
    if (method === 'tools/call' && ctx.protocol === 'mcp') {
      method = 'tools/call_mcp';
    }
    if (!isStr(method)) return jrpcErr(envelope.id ?? null, -32600, 'Invalid Request: method missing');
    const handler = this.handlers.get(method);
    if (!handler) return jrpcErr(envelope.id ?? null, -32601, 'Method not found: ' + method);
    try {
      const result = await handler(params, ctx);
      if (isNotification) return null;
      return jrpcOk(envelope.id, result);
    } catch (e) {
      const code = typeof e.code === 'number' ? e.code : -32000;
      return jrpcErr(envelope.id ?? null, code, e.message ?? String(e), e.data ?? undefined);
    }
  }

  // ACP pubsub --------------------------------------------------------
  publish(topic, payload) {
    const subs = this.subscriptions.get(topic);
    if (!subs || subs.size === 0) return 0;
    const notif = jrpcNotif('acp/pub', { topic, payload, publishedAt: Date.now() });
    let sent = 0;
    for (const tp of subs) try { tp.send(notif); sent++; } catch {}
    return sent;
  }

  // Convenience: full handler (JSON-RPC POST) for use inside http servers without transport
  async handleRawHttp(bodyText, opts) {
    const envelope = JSON.parse(bodyText);
    const tp = new InProcessServerTransport();
    this.attachTransport(tp, opts?.protocol ?? 'jsonrpc');
    const outs = [];
    tp.on('out', (m) => outs.push(m));
    tp.inject(envelope);
    await new Promise(r => setTimeout(r, 5));
    return outs;
  }
}

export function createSdkServer(opts) { return new SdkServer(opts); }

// ─────────────────────────────────────────────────────────────────────
// SdkClient: works against jsonrpc/acp/mcp endpoint with any transport
// ─────────────────────────────────────────────────────────────────────
export class SdkClient extends EventEmitter {
  constructor(config) {
    super();
    this.config = config ?? {};
    this._nextId = 1;
    this._pending = new Map();
    this._httpTransport = null;
    this._streamTransport = null;
    this._opened = false;
  }
  async open() {
    if (this._opened) return;
    // Pick transports based on config
    if (this.config.type === 'stdio') {
      const tp = new StdioClientTransport(this.config);
      this._streamTransport = tp;
      this._httpTransport = null;
      await tp.open();
      tp.on('message', (msg) => this._onMessage(msg));
      tp.on('close', () => this.emit('close'));
    } else if (this.config.type === 'http' || this.config.url) {
      this._httpTransport = new HttpClientTransport(this.config.url, { protocol: this.config.protocol ?? 'detect', headers: this.config.headers ?? {} });
      await this._httpTransport.open();
      if (this.config.sseUrl) {
        const sse = new SseClientTransport(this.config.sseUrl, { headers: this.config.headers ?? {} });
        this._streamTransport = sse;
        await sse.open();
        sse.on('message', (msg) => this._onMessage(msg));
      }
    }
    this._opened = true;
  }
  async request(method, params, opts) {
    if (!this._opened) await this.open();
    const id = opts?.id ?? (this._nextId++);
    if (this._httpTransport && !opts?.streamOnly) {
      // Over HTTP POST we do round-trip single call
      const result = await this._httpTransport.request({ jsonrpc: JSONRPC_VERSION, id, method, params: params ?? {} });
      return this._unwrapResponse(result, id);
    }
    // Over streaming transports: send single, wait for response with matching id
    return new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('SDK request timeout: ' + method)), opts?.timeoutMs ?? 15_000);
      this._pending.set(id, (err, val) => { clearTimeout(to); if (err) reject(err); else resolve(val); });
      try {
        this._streamTransport.send({ jsonrpc: JSONRPC_VERSION, id, method, params: params ?? {} });
      } catch (e) { this._pending.delete(id); clearTimeout(to); reject(e); }
    });
  }
  notify(method, params) {
    if (this._streamTransport) this._streamTransport.send({ jsonrpc: JSONRPC_VERSION, method, params: params ?? {} });
    else if (this._httpTransport) this._httpTransport.request({ jsonrpc: JSONRPC_VERSION, method, params: params ?? {} }).catch(() => {});
  }
  onSubscription(topic, handler) { return this.on('pub:' + topic, handler); }
  subscribe(topic, opts) { return this.request('acp.subscribe', { topic }, opts); }
  unsubscribe(topic, opts) { return this.request('acp.unsubscribe', { topic }, opts); }
  publish(topic, payload, opts) { return this.request('acp/publish', { topic, payload }, opts); }

  // Tool shortcuts
  listTools() { return this.request('tools/list'); }
  callTool(name, args, meta) { return this.request('tools/call', { name, arguments: args ?? {}, meta: meta ?? {} }); }

  _onMessage(msg) {
    // Subscription notification?
    if (msg && msg.method === 'acp/pub' && msg.params && msg.params.topic) {
      this.emit('pub:' + msg.params.topic, msg.params);
      return;
    }
    if (msg && typeof msg.id !== 'undefined') {
      const p = this._pending.get(msg.id);
      if (!p) return;
      this._pending.delete(msg.id);
      if (msg.error) p(new Error(msg.error.message ?? JSON.stringify(msg.error)), null);
      else p(null, msg.result);
      return;
    }
    // Otherwise broadcast as raw event
    this.emit('message', msg);
  }
  _unwrapResponse(result, id) {
    if (Array.isArray(result)) {
      const r = result.find(x => x && x.id === id);
      if (!r) throw new Error('No response matching id=' + id);
      result = r;
    }
    if (result && result.error) throw new Error(result.error.message ?? JSON.stringify(result.error));
    return result && result.result;
  }
  async close() {
    try { this._streamTransport?.close(); } catch {}
    try { this._httpTransport?.close(); } catch {}
    this._opened = false;
  }
}

export function createSdkClient(cfg) { return new SdkClient(cfg); }

// ─────────────────────────────────────────────────────────────────────
// Exports intended for external consumers.
// If guang exposes itself as an NPM package, the `exports` field should
// re-export these.
// ─────────────────────────────────────────────────────────────────────
export const SDK_PACKAGE_INFO = Object.freeze({
  name: '@guang-code/sdk',
  version: '1.0.0',
  description: 'Guang Code interop SDK: MCP / ACP / JSON-RPC 2.0 — tools, memory, session, skills, plugins, pubsub.',
  protocols: ['mcp','acp','jsonrpc'],
  transports: ['stdio','http','sse','ndjson'],
});
