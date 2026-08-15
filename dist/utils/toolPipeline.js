// ============================================================
//  Guang Code — Tool Pipeline (Waterfall)
//  Unified: onPreExecute -> execute -> onPostExecute + listeners
//  Responsibility: auth, timeout, audit, redaction, cost tracking
// ============================================================
import { randomUUID } from 'crypto';
import { setTimeout as pSetTimeout } from 'timers/promises';

export const PHASES = Object.freeze(['pre', 'execute', 'post']);

export class PipelineAbortError extends Error {
  constructor(reason, replacementResult) {
    super(reason);
    this.name = 'PipelineAbortError';
    this.replacementResult = replacementResult ?? null;
    this.aborted = true;
  }
}

function toHashable(input) {
  if (input === null || input === undefined) return '';
  if (typeof input === 'string') return input.slice(0, 4096);
  try { return JSON.stringify(input).slice(0, 4096); } catch { return String(input).slice(0, 4096); }
}

// ---- Listeners: each is { phase, priority, fn } -----------------
export class ToolPipeline {
  constructor(opts) {
    this._listeners = { pre: [], execute: [], post: [], error: [] };
    this._auditTrail = new Map();  // callId -> array of events
    this._defaultTimeoutMs = opts?.defaultTimeoutMs ?? 180_000; // 3 min
    this._callCount = 0;
    this._stats = { totalCalls: 0, successes: 0, failures: 0, cumulativeMs: 0 };
  }

  get stats() { return { ...this._stats }; }
  get totalCalls() { return this._callCount; }
  recentAudit(callId) { return this._auditTrail.get(callId) ?? []; }

  // ---- listener registration ---------------------------------
  /** phase: 'pre' -> fn(ctx,next). can mutate ctx.input, throw PipelineAbortError to replace, or call next() */
  register(phase, listener, opts) {
    if (!this._listeners[phase]) throw new Error(`[tool-pipeline] invalid phase: ${phase}`);
    const entry = {
      name: opts?.name ?? `anon-${phase}-${this._listeners[phase].length}`,
      priority: opts?.priority ?? 50,
      fn: listener,
      disabled: false,
    };
    this._listeners[phase].push(entry);
    this._listeners[phase].sort((a, b) => a.priority - b.priority);
    return function unregister() { entry.disabled = true; };
  }

  // ---- helpers: quick built-ins ------------------------------
  /** Max ms per tool invocation (execute phase) */
  addTimeout(toolNamePattern, timeoutMs, opts) {
    const re = typeof toolNamePattern === 'string' ? new RegExp('^' + toolNamePattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') : toolNamePattern;
    const ms = timeoutMs ?? this._defaultTimeoutMs;
    return this.register('execute', async (ctx, next) => {
      if (!re.test(ctx.toolName)) return next();
      const ac = new AbortController();
      const timeoutP = (async () => {
        await pSetTimeout(ms, undefined, { signal: ac.signal });
        const e = new PipelineAbortError(
          `[tool-pipeline] ${ctx.toolName} exceeded ${ms}ms timeout.`,
          { content: `Tool "${ctx.toolName}" timed out after ${ms}ms.`, isError: true }
        );
        e.code = 'TOOL_TIMEOUT';
        throw e;
      })();
      try {
        const [result] = await Promise.allSettled([next(), timeoutP]).then(async (results) => {
          ac.abort();
          const execRes = results[0];
          const tRes    = results[1];
          if (execRes.status === 'rejected') throw execRes.reason;
          if (tRes.status === 'rejected' && tRes.reason?.aborted) throw tRes.reason;
          return [execRes.value];
        });
        return result;
      } finally {
        try { ac.abort(); } catch {}
      }
    }, { name: `timeout:${String(toolNamePattern)}`, priority: opts?.priority ?? 5 });
  }

  /** Permission request handler (pre phase) — calls ctx.context.onPermissionRequest */
  addPermissionGate(opts) {
    return this.register('pre', async (ctx, next) => {
      const context = ctx.context;
      if (typeof context?.onPermissionRequest !== 'function') return next();
      // Build description (use existing hook from project)
      const descFn = opts?.buildDescription ?? (({ toolName, input, cwd }) => `Tool: ${toolName}\nInput: ${toHashable(input)}\nCWD: ${cwd ?? '(unknown)'}`);
      const allowed = await context.onPermissionRequest(ctx.toolName, descFn({ toolName: ctx.toolName, input: ctx.input, cwd: ctx.cwd }));
      if (allowed !== true) {
        const reason = context.lastPermissionReason?.();
        const msg = `Permission denied for tool "${ctx.toolName}".${reason ? `\nReason: ${reason}` : ''}`;
        throw new PipelineAbortError(msg, { content: msg, isError: true, denied: true });
      }
      return next();
    }, { name: 'permission-gate', priority: opts?.priority ?? 20 });
  }

  /** Redaction (post phase) — scan for 32+ char hex/base64 secrets and replace with ***secret:N*** */
  addRedaction(redactorFn, opts) {
    const redact = redactorFn ?? defaultRedact;
    return this.register('post', (ctx, next) => {
      const result = next();
      if (result == null) return result;
      if (typeof result.content === 'string') {
        result.content = redact(result.content, ctx) ?? result.content;
      } else if (Array.isArray(result.content)) {
        result.content = result.content.map(chunk => {
          if (chunk && typeof chunk.text === 'string') {
            chunk.text = redact(chunk.text, ctx) ?? chunk.text;
          }
          return chunk;
        });
      }
      return result;
    }, { name: 'redaction', priority: opts?.priority ?? 90 });
  }

  /** Audit log (write to KV storage.memory/stats table if available) */
  addAuditTrail(opts) {
    return this.register('post', (ctx, next) => {
      const callId = ctx.callId;
      const arr = this._auditTrail.get(callId) ?? [];
      arr.push({ phase: 'post', at: Date.now(), toolName: ctx.toolName, status: 'ok' });
      this._auditTrail.set(callId, arr);
      if (opts?.onAuditRecord) try { opts.onAuditRecord(ctx, 'ok'); } catch {}
      return next();
    }, { name: 'audit-ok', priority: 95 }) &&
    this.register('error', (ctx) => {
      const arr = this._auditTrail.get(ctx.callId) ?? [];
      arr.push({ phase: 'error', at: Date.now(), toolName: ctx.toolName, error: ctx.error?.message ?? String(ctx.error) });
      this._auditTrail.set(ctx.callId, arr);
      if (opts?.onAuditRecord) try { opts.onAuditRecord(ctx, 'error'); } catch {}
    }, { name: 'audit-error', priority: 95 });
  }

  /** Truncate very long outputs before returning to the model (post phase) */
  addOutputTruncation(maxChars, opts) {
    const limit = maxChars ?? 20_000;
    return this.register('post', (ctx, next) => {
      const result = next();
      if (result && typeof result.content === 'string' && result.content.length > limit) {
        result.content = result.content.slice(0, limit) + `\n…(output truncated to ${limit} chars; use file write for larger output)`;
      }
      return result;
    }, { name: `truncate:${limit}`, priority: opts?.priority ?? 85 });
  }

  // ---- main execution ----------------------------------------
  async run(ctx, executorFn) {
    const callId = (ctx && ctx.callId) || randomUUID();
    const startAt = Date.now();
    const pipelineCtx = {
      callId,
      toolName: ctx.toolName,
      input: ctx.input,
      cwd: ctx.cwd,
      context: ctx.context,
      sessionId: ctx.sessionId ?? null,
      startedAt: startAt,
      endedAt: 0,
      durationMs: 0,
      error: null,
      phase: 'pre',
      attempt: 0,
    };
    this._auditTrail.set(callId, [{ phase: 'pre', at: startAt, toolName: ctx.toolName }]);
    this._callCount++;
    this._stats.totalCalls++;

    // Run pre -> execute -> post waterfall. Each phase supports next() chaining.
    try {
      let last = pipelineCtx;
      // PRE
      for (const l of this._listeners.pre) {
        if (l.disabled) continue;
        pipelineCtx.phase = 'pre';
        let called = false;
        const next = () => { called = true; return last; };
        const out = await l.fn(pipelineCtx, next);
        last = (called && out === undefined) ? last : (out ?? last);
      }
      // EXECUTE (wrapped by execute-phase listeners; default inner = executorFn)
      pipelineCtx.phase = 'execute';
      const execChain = [...this._listeners.execute.filter(l => !l.disabled)];
      let result;
      if (execChain.length === 0) {
        result = await executorFn(pipelineCtx);
      } else {
        let i = 0;
        const callNext = async () => {
          if (i >= execChain.length) return executorFn(pipelineCtx);
          const l = execChain[i++];
          let called = false;
          const nn = () => { called = true; return callNext(); };
          const out = await l.fn(pipelineCtx, nn);
          return (called && out === undefined) ? await callNext() : out;
        };
        result = await callNext();
      }
      pipelineCtx.result = result;
      // POST
      pipelineCtx.phase = 'post';
      for (const l of this._listeners.post) {
        if (l.disabled) continue;
        let called = false;
        const next = () => { called = true; return result; };
        const out = await l.fn(pipelineCtx, next);
        result = (called && out === undefined) ? result : (out ?? result);
      }
      pipelineCtx.endedAt = Date.now();
      pipelineCtx.durationMs = pipelineCtx.endedAt - startAt;
      this._stats.successes++;
      this._stats.cumulativeMs += pipelineCtx.durationMs;
      return { callId, result, durationMs: pipelineCtx.durationMs };
    } catch (err) {
      pipelineCtx.error = err;
      pipelineCtx.endedAt = Date.now();
      pipelineCtx.durationMs = pipelineCtx.endedAt - startAt;
      this._stats.failures++;
      this._stats.cumulativeMs += pipelineCtx.durationMs;
      // run error listeners (fire-and-forget, sync-ish)
      for (const l of this._listeners.error) {
        if (l.disabled) continue;
        try { await l.fn(pipelineCtx); } catch { /* swallow */ }
      }
      if (err instanceof PipelineAbortError && err.replacementResult) {
        return {
          callId,
          result: err.replacementResult,
          durationMs: pipelineCtx.durationMs,
          aborted: true,
          abortReason: err.message,
        };
      }
      // rethrow
      throw err;
    }
  }
}

// ---- default secret redactor -------------------------------------
function defaultRedact(text) {
  if (typeof text !== 'string') return text;
  const replacements = [];
  let counter = 0;
  let t = text;
  // 40+ hex chars (API keys often, but skip UUID-like 8-4-4-4-12)
  t = t.replace(/\b(?![0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b)[0-9a-fA-F]{40,}\b/g, (m) => {
    const id = counter++; replacements.push(m); return `***secret:hex-${id}***`;
  });
  // Bearer tokens
  t = t.replace(/\bBearer\s+[A-Za-z0-9\-_.=+/]{16,}\b/g, (m) => {
    const id = counter++; replacements.push(m); return `Bearer ***secret:bearer-${id}***`;
  });
  // sk-xxx / pk-xxx (OpenAI-style)
  t = t.replace(/\b(sk|pk|rk|sb)-[A-Za-z0-9\-_]{10,}\b/g, (m) => {
    const id = counter++; replacements.push(m); return `***secret:sk-${id}***`;
  });
  // AWS Access Key ID / Secret patterns
  t = t.replace(/\bAKIA[0-9A-Z]{16}\b/g, (m) => {
    const id = counter++; replacements.push(m); return `***secret:aws-${id}***`;
  });
  // GitHub tokens
  t = t.replace(/\bghp_[A-Za-z0-9]{20,}\b/g, (m) => {
    const id = counter++; replacements.push(m); return `***secret:gh-${id}***`;
  });
  return t;
}

export const defaultToolPipeline = new ToolPipeline({ defaultTimeoutMs: 180_000 });
