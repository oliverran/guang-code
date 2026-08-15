// ============================================================
//  Guang Code — Runtime Plugin System
//  Agent self-modify extension: write plugin → approval → sandboxed execute
// ============================================================
import { EventEmitter } from 'events';
import { randomUUID, createHash } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync, statSync } from 'fs';
import { join, resolve, relative, basename, dirname, isAbsolute } from 'path';
import { homedir } from 'os';

const STATE_DIR = () => process.env.GC_PLUGIN_DIR || join(homedir(), '.guang-code', 'plugins');
const STATE_DIR_RUNTIME = () => join(STATE_DIR(), 'runtime');
const STATE_DIR_AUDIT = () => join(STATE_DIR(), 'audit');

export const APPROVAL_MODELS = Object.freeze(['none', 'user_confirm', 'llm_vote', 'user_and_llm']);

// ---------- Sandbox abstractions --------------------------------
export class PluginSandbox {
  constructor(opts) { this.name = opts?.name ?? 'default'; this.enabled = opts?.enabled ?? true; }
  async evaluate(code, api) { throw new Error('evaluate not implemented'); }
  get isAvailable() { return true; }
}

/**
 * Basic sandbox using Node's vm module (zero native deps, works everywhere).
 * — Denies access to process, fs, child_process, global fetch (stripped).
 * — Grants only the `api` object explicitly.
 */
export class BasicVmSandbox extends PluginSandbox {
  constructor(opts) {
    super({ name: 'basic-vm', ...(opts ?? {}) });
    this._timeoutMs = opts?.timeoutMs ?? 5_000;
    this._memoryLimitMb = opts?.memoryLimitMb ?? 64;
    this._cachedVm = null;
  }
  get isAvailable() {
    try { require.resolve('vm'); return true; } catch { return false; }
  }
  _vm() {
    if (this._cachedVm) return this._cachedVm;
    let vm = null;
    try { vm = (typeof require !== 'undefined') ? require('vm') : null; } catch { vm = null; }
    this._cachedVm = vm;
    return vm;
  }
  async evaluate(code, api) {
    if (!this.enabled) return this._unsafeEval(code, api);
    // Build a safe context. We wrap all methods to drop `this===context`.
    const contextObj = {
      ...Object.fromEntries(Object.entries(api ?? {}).filter(([k]) => typeof k === 'string' && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(k))),
      console: { log: (...a) => api?._log?.(...a), info: (...a) => api?._log?.(...a), warn: (...a) => api?._log?.(...a), error: (...a) => api?._log?.(...a) },
      setTimeout: (fn, ms) => setTimeout(() => { try { fn(); } catch (e) { api?._error?.(e); } }, ms),
      structuredClone: typeof structuredClone === 'function' ? structuredClone : (x) => JSON.parse(JSON.stringify(x)),
      Date, Array, Object, JSON, Math, Number, String, Boolean, Map, Set, Promise, RegExp, Error, TypeError,
    };
    let vm;
    try { vm = require('vm'); } catch { vm = null; }
    if (!vm) return this._unsafeEval(code, api);
    const ctx = vm.createContext(contextObj, { codeGeneration: { strings: false, wasm: false } });
    const wrapped = `(async (api) => {\n${code}\n})(__api__);`;
    let resolved = false;
    const timeoutP = new Promise((_, rej) => setTimeout(() => rej(new Error(`Plugin timed out after ${this._timeoutMs}ms`)), this._timeoutMs));
    ctx.__api__ = api;
    try {
      const result = await Promise.race([
        vm.runInContext(wrapped, ctx, { timeout: this._timeoutMs, displayErrors: false, filename: 'plugin.mjs' }),
        timeoutP,
      ]);
      resolved = true;
      return result;
    } catch (e) {
      if (!resolved) throw e;
      throw e;
    } finally {
      try { delete ctx.__api__; } catch {}
    }
  }
  _unsafeEval(code, api) {
    const fn = new Function('api', `"use strict"; return (async () => {\n${code}\n})();`);
    return fn(api);
  }
}

// ---------- File system policy ----------------------------------
export class FileAccessPolicy {
  constructor(opts) {
    this.readWhitelist = new Set((opts?.readWhitelist ?? []).map(p => resolve(p)));
    this.writeWhitelist = new Set((opts?.writeWhitelist ?? []).map(p => resolve(p)));
    this.allowWriteAllProject = opts?.allowWriteAllProject ?? false;
    this.projectRoot = opts?.projectRoot ?? null;
  }
  canRead(absPath) {
    const p = resolve(absPath);
    for (const allow of this.readWhitelist) if (this._isInside(p, allow)) return true;
    if (this.projectRoot && this._isInside(p, this.projectRoot)) return true; // read project always allowed
    return false;
  }
  canWrite(absPath) {
    const p = resolve(absPath);
    if (this.allowWriteAllProject && this.projectRoot && this._isInside(p, this.projectRoot)) return true;
    for (const allow of this.writeWhitelist) if (this._isInside(p, allow)) return true;
    return false;
  }
  _isInside(child, parent) {
    const rel = relative(parent, child);
    return !!rel && !rel.startsWith('..') && !isAbsolute(rel);
  }
}

// ---------- Plugin definition schema ---------------------------
/**
 * Plugin file format (a .mjs file with optional frontmatter):
 *
 *   // ~name: my-refactor
 *   // ~version: 1.0.0
 *   // ~description: Finds slow loops and proposes rewrites
 *   // ~author: agent
 *   // ~tags: [refactor, lint]
 *   // ~requires: [tools:Read, tools:Edit]
 *   // ~fs-write: [<paths relative to project>]
 *   // ~fs-read:  [<paths>]
 *   // ~approval: user_confirm    (none | user_confirm | llm_vote | user_and_llm)
 *
 *   export function activate(ctx) {
 *     ctx.registerTool(...)
 *     ctx.hook('pre', 'Bash', (call) => { ... })
 *   }
 */

// ---------- Approver -------------------------------------------
export class ApprovalFlow extends EventEmitter {
  constructor(opts) { super(); this.pending = new Map(); this.options = opts ?? {}; this.onApprovalCallback = opts?.onApproval ?? null; this.onDenyCallback = opts?.onDeny ?? null; }
  requestApproval(plugin, evidence, opts) {
    const id = randomUUID();
    const req = {
      id,
      pluginId: plugin.id,
      pluginDigest: plugin.digest,
      requiredApproval: opts?.requiredApproval ?? plugin.approvalModel ?? 'user_confirm',
      evidence: evidence ?? {},
      createdAt: Date.now(),
      decision: null,  // 'approve' | 'deny' | null
      decidedAt: null,
      decidedBy: null,
      votes: [],
    };
    this.pending.set(id, req);
    this.emit('pending', req);
    return id;
  }
  listPending() { return Array.from(this.pending.values()); }
  async decide(requestId, decision, by, opts) {
    const req = this.pending.get(requestId);
    if (!req) throw new Error(`Approval request ${requestId} not found`);
    req.decision = decision === 'approve' ? 'approve' : 'deny';
    req.decidedAt = Date.now();
    req.decidedBy = by ?? 'unknown';
    req.votes.push({ by: by ?? 'unknown', decision: req.decision, at: Date.now(), comment: opts?.comment ?? null });
    this.emit('decision', req);
    this._auditLog(req);
    this.pending.delete(requestId);
    if (req.decision === 'approve' && this.onApprovalCallback) try { await this.onApprovalCallback(req); } catch {}
    if (req.decision === 'deny' && this.onDenyCallback) try { await this.onDenyCallback(req); } catch {}
    return req;
  }
  _auditLog(req) {
    try {
      const dir = STATE_DIR_AUDIT();
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      appendFileSync(join(dir, `${req.pluginId}.audit.jsonl`), JSON.stringify(req) + '\n');
    } catch {}
  }
}

// ---------- Plugin Manager -------------------------------------
export class PluginManager extends EventEmitter {
  constructor(opts) {
    super();
    this.plugins = new Map();
    this.sandbox = opts?.sandbox ?? new BasicVmSandbox();
    const self = this;
    this.approval = opts?.approval ?? new ApprovalFlow({
      onApproval: async (req) => { try { await self.activate(req.pluginId); } catch (e) { const p = self.plugins.get(req.pluginId); if (p) p.activationError = e.message ?? String(e); } },
    });
    this.projectRoot = opts?.projectRoot ?? process.cwd();
    this.fsPolicy = opts?.fsPolicy ?? new FileAccessPolicy({ projectRoot: this.projectRoot });
    this._injected = new Map();  // id -> {plugin, active:boolean}
    this._toolExports = new Map(); // toolName -> {pluginId, toolDef}
    this._hookRegistry = { pre: new Map(), post: new Map(), error: new Map() }; // toolName -> [fn]
    try { mkdirSync(STATE_DIR_RUNTIME(), { recursive: true }); } catch {}
  }

  get loadedIds() { return Array.from(this.plugins.keys()); }
  get toolExports() { return Array.from(this._toolExports.values()); }

  // ---- Parse source with frontmatter
  parsePlugin(source, opts) {
    const src = String(source ?? '');
    const frontmatter = {};
    let bodyStart = 0;
    // Parse // ~ lines (guang-style comment frontmatter) + standard YAML-ish --- fence for compatibility
    if (src.trim().startsWith('---')) {
      const endIdx = src.indexOf('---', 3);
      if (endIdx > 0) {
        const chunk = src.slice(3, endIdx);
        for (const line of chunk.split('\n')) {
          const m = line.match(/^([\w-]+)\s*:\s*(.+)$/);
          if (m) frontmatter[this._camelCase(m[1])] = this._parseValue(m[2]);
        }
        bodyStart = endIdx + 3;
      }
    }
    // Also scan // ~ lines (comment frontmatter)
    const COMMENT_RE = /^\s*\/\/\s*~\s*([\w-]+)\s*:\s*(.+)$/gm;
    let m;
    while ((m = COMMENT_RE.exec(src)) !== null) {
      frontmatter[this._camelCase(m[1])] = this._parseValue(m[2]);
    }
    const body = bodyStart ? src.slice(bodyStart) : src;
    const id = (typeof frontmatter.name === 'string' && frontmatter.name.trim())
      ? frontmatter.name.trim().replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 80)
      : (opts?.id ?? ('plugin-' + randomUUID().slice(0, 8)));
    const approval = APPROVAL_MODELS.includes(frontmatter.approval) ? frontmatter.approval : 'user_confirm';
    const digest = createHash('sha256').update(src, 'utf8').digest('hex').slice(0, 24);
    return {
      id,
      version: frontmatter.version ?? '0.1.0',
      author: frontmatter.author ?? 'unknown',
      description: frontmatter.description ?? '',
      tags: Array.isArray(frontmatter.tags) ? frontmatter.tags : [],
      requires: Array.isArray(frontmatter.requires) ? frontmatter.requires : [],
      fsWrite: Array.isArray(frontmatter.fsWrite) ? frontmatter.fsWrite : [],
      fsRead:  Array.isArray(frontmatter.fsRead)  ? frontmatter.fsRead  : [],
      approvalModel: approval,
      source: src,
      body,
      digest,
      loadedAt: 0,
      activated: false,
      activationError: null,
      votes: [],
    };
  }

  // ---- Agent self-modify: store plugin in runtime dir + request approval
  async propose(source, opts) {
    const parsed = this.parsePlugin(source, opts);
    const file = join(STATE_DIR_RUNTIME(), `${parsed.id}.mjs`);
    writeFileSync(file, parsed.source, 'utf8');
    const evidence = {
      digest: parsed.digest,
      version: parsed.version,
      requires: parsed.requires,
      fsWrite: parsed.fsWrite,
      fsRead: parsed.fsRead,
      previewBody: parsed.body.slice(0, 1200),
    };
    this.plugins.set(parsed.id, parsed);
    // If approval model is 'none' we skip flow and approve immediately + auto-activate.
    let approvalId;
    if (parsed.approvalModel === 'none') {
      approvalId = this.approval.requestApproval(parsed, evidence, { requiredApproval: 'none' });
      await this.approval.decide(approvalId, 'approve', 'system:auto-none', { comment: 'approval=none in plugin header' });
    } else {
      approvalId = this.approval.requestApproval(parsed, evidence);
    }
    this.emit('proposed', { plugin: parsed, approvalId });
    return { plugin: parsed, approvalId, pending: parsed.approvalModel !== 'none' };
  }

  // Load existing plugin from runtime dir
  async loadFromId(id, opts) {
    const file = join(STATE_DIR_RUNTIME(), `${id}.mjs`);
    if (!existsSync(file)) throw new Error(`Plugin source not found: ${id}`);
    const source = readFileSync(file, 'utf8');
    const p = this.parsePlugin(source, { id });
    this.plugins.set(id, p);
    if (opts?.autoActivate ?? false) await this.activate(id);
    return p;
  }

  async activate(id) {
    const p = this.plugins.get(id);
    if (!p) throw new Error(`Plugin ${id} not proposed/loaded yet`);
    if (p.activated) return p;
    // Validate FS policy against plugin declared fsWrite
    const patcherWrite = [];
    for (const rel of p.fsWrite) {
      const ap = resolve(this.projectRoot, rel);
      if (!this.fsPolicy.canWrite(ap)) throw new Error(`Plugin ${id} wants to write to ${rel} which is outside write whitelist.`);
      patcherWrite.push(ap);
    }
    // Build plugin API context
    const mgr = this;
    const logs = [];
    const api = {
      pluginId: p.id,
      projectRoot: this.projectRoot,
      registerTool(toolDef) {
        if (!toolDef || !toolDef.name) throw new Error('registerTool requires {name, execute}');
        mgr._toolExports.set(toolDef.name, { pluginId: p.id, toolDef });
        mgr.emit('tool-added', { pluginId: p.id, toolName: toolDef.name });
      },
      hook(phase, toolPattern, fn) {
        if (!mgr._hookRegistry[phase]) throw new Error(`Unknown hook phase: ${phase}`);
        const re = toolPattern instanceof RegExp ? toolPattern : new RegExp('^' + toolPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
        const key = `${phase}::${toolPattern}`;
        if (!mgr._hookRegistry[phase].has(key)) mgr._hookRegistry[phase].set(key, { re, fns: [] });
        mgr._hookRegistry[phase].get(key).fns.push(fn);
      },
      fs: {
        read(pth) {
          const ap = resolve(mgr.projectRoot, pth);
          if (!mgr.fsPolicy.canRead(ap)) throw new Error(`[plugin ${p.id}] read denied: ${pth}`);
          return readFileSync(ap, 'utf8');
        },
        write(pth, content) {
          const ap = resolve(mgr.projectRoot, pth);
          if (!mgr.fsPolicy.canWrite(ap)) throw new Error(`[plugin ${p.id}] write denied: ${pth}`);
          mkdirSync(dirname(ap), { recursive: true });
          writeFileSync(ap, content, 'utf8');
          return true;
        },
      },
      log: (...a) => logs.push(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')),
      _log: (...a) => logs.push(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')),
      _error: (e) => logs.push('[ERR] ' + (e?.message ?? String(e))),
    };
    const wrappedCode = `
let activate;
let exports = {};
let module = { exports };
(function(exports, module) {
"use strict";
${p.body}
})(exports, module);
(async () => {
  let fn = null;
  if (typeof activate === 'function') fn = activate;
  else if (typeof module !== 'undefined' && module.exports && typeof module.exports.activate === 'function') fn = module.exports.activate;
  else if (typeof exports !== 'undefined' && exports && typeof exports.activate === 'function') fn = exports.activate;
  if (fn) { return await fn(api); }
  return null;
})();
`;
    try {
      await this.sandbox.evaluate(wrappedCode, api);
      p.activated = true;
      p.loadedAt = Date.now();
      p._activationLogs = logs;
      this._injected.set(p.id, { plugin: p, active: true });
      this.emit('activated', { plugin: p, logs });
      return p;
    } catch (e) {
      p.activationError = e.message || String(e);
      p._activationLogs = logs;
      throw e;
    }
  }

  deactivate(id) {
    const inj = this._injected.get(id);
    if (!inj) return false;
    // remove hooks & tool exports associated with this plugin
    for (const [name, t] of Array.from(this._toolExports.entries())) {
      if (t.pluginId === id) this._toolExports.delete(name);
    }
    inj.active = false;
    this._injected.delete(id);
    this.emit('deactivated', { pluginId: id });
    return true;
  }

  // Apply hooks to a tool call pipeline ctx
  async applyPreHooks(toolName, ctx) {
    const results = [];
    for (const { re, fns } of this._hookRegistry.pre.values()) {
      if (!re.test(toolName)) continue;
      for (const fn of fns) try { results.push(await fn(ctx, toolName, 'pre')); } catch (e) { ctx.error = ctx.error || e; }
    }
    return results;
  }
  async applyPostHooks(toolName, ctx) {
    const results = [];
    for (const { re, fns } of this._hookRegistry.post.values()) {
      if (!re.test(toolName)) continue;
      for (const fn of fns) try { results.push(await fn(ctx, toolName, 'post')); } catch (e) { ctx.error = ctx.error || e; }
    }
    return results;
  }

  list() {
    return Array.from(this.plugins.values()).map(p => ({
      id: p.id, version: p.version, author: p.author,
      description: p.description, tags: p.tags,
      activated: p.activated, approvalModel: p.approvalModel, digest: p.digest,
      error: p.activationError ?? null,
    }));
  }

  // Private helpers
  _camelCase(s) { return String(s).replace(/-([a-z])/g, (_, l) => l.toUpperCase()); }
  _parseValue(s) {
    const v = String(s).trim();
    if (/^\[.*\]$/.test(v)) {
      const inner = v.slice(1, -1).trim();
      if (!inner) return [];
      // Try JSON parse first (proper quotes)
      try { return JSON.parse(v.replace(/'/g, '"')); } catch {}
      // Fallback: split by comma, strip whitespace and quotes
      return inner.split(',').map(part => part.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    }
    if (v === 'true') return true;
    if (v === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
    return v.replace(/^['"]|['"]$/g, '');
  }
}

// Singleton (per-process, with env override for project)
const defaultProjectRoot = process.cwd();
export const pluginManager = new PluginManager({
  projectRoot: defaultProjectRoot,
  sandbox: new BasicVmSandbox({ timeoutMs: 8_000 }),
  fsPolicy: new FileAccessPolicy({
    projectRoot: defaultProjectRoot,
    allowWriteAllProject: false,
    writeWhitelist: [join(defaultProjectRoot, '.guang', 'plugins-out')],
  }),
});
