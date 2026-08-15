// ============================================================
//  Guang Code — Compaction Seam
//  Pluggable compaction strategies with registry + budget
// ============================================================
import { randomUUID } from 'crypto';
import { homedir } from 'os';
import { join } from 'path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';

function env(name, fb) { const v = process.env[name]; return typeof v === 'string' && v.trim() ? v.trim() : fb; }
const STATE_DIR = () => env('GC_COMPACT_STATE_DIR', join(homedir(), '.guang-code', 'compaction'));

export const COMPACTION_STRATEGIES = Object.freeze([
  'keep_last',
  'summary_inject',
  'summary_llm',
  'hybrid',
]);

// Abstract base ---------------------------------------------------------
export class SessionCompactor {
  constructor(opts) { this.name = opts?.name ?? this.constructor.name; }
  /**
   * @param {{messages:Array, maxMessages?:number, maxChars?:number, cwd?:string, llmSummary?:(prompt:string)=>Promise<string>}} ctx
   * @returns {Promise<{messages:Array, removed:number, kept:number, report:string}>}
   */
  async compact(ctx) { throw new Error('SessionCompactor.compact must be overridden'); }
  get capabilities() { return Object.freeze({ canUseLLM: false }); }
}

// Strategy 1: Keep last N -------------------------------------------------
export class KeepLastCompactor extends SessionCompactor {
  constructor(opts) { super({ name: 'keep_last' }); this.keep = opts?.keep ?? 8; }
  async compact(ctx) {
    const keep = ctx.maxMessages ?? this.keep;
    const msgs = ctx.messages ?? [];
    if (msgs.length <= keep) return { messages: msgs, removed: 0, kept: msgs.length, report: `No compaction needed (${msgs.length} <= ${keep})` };
    const kept = msgs.slice(-keep);
    const removed = msgs.length - kept.length;
    const marker = {
      id: randomUUID(),
      role: 'system',
      timestamp: Date.now(),
      content: `[Conversation compacted by keep_last strategy (keep=${keep}): ${removed} earlier messages dropped. Retaining context for current coding task at ${ctx.cwd ?? '(unknown)'}]`,
    };
    return { messages: [marker, ...kept], removed, kept: kept.length + 1, report: `keep_last: dropped ${removed}, kept ${kept.length}+marker` };
  }
}

// Strategy 2: Summary inject (template, no LLM) -------------------------
export class TemplateSummaryCompactor extends SessionCompactor {
  constructor(opts) { super({ name: 'summary_inject' }); this.keepTail = opts?.keepTail ?? 6; }
  async compact(ctx) {
    const msgs = ctx.messages ?? [];
    const keep = Math.max(2, ctx.maxMessages ?? this.keepTail);
    if (msgs.length <= keep + 4) return { messages: msgs, removed: 0, kept: msgs.length, report: 'Too short to summarize' };
    const cutAt = msgs.length - keep;
    const earlier = msgs.slice(0, cutAt);
    const tail = msgs.slice(cutAt);
    const userTurns = earlier.filter(m => m.role === 'user').length;
    const assistantTurns = earlier.filter(m => m.role === 'assistant').length;
    const charsInEarlier = earlier.reduce((acc, m) => acc + (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content ?? '').length), 0);
    const markers = [];
    // Collect goals from first user message
    const firstUser = earlier.find(m => m.role === 'user');
    const goal = firstUser && typeof firstUser.content === 'string' ? firstUser.content.slice(0, 800) : '(not captured)';
    markers.push({
      id: randomUUID(), role: 'system', timestamp: Date.now(),
      content: [
        `[Conversation compacted by summary_inject strategy]`,
        `  • Earlier turns: ${userTurns} user, ${assistantTurns} assistant (${charsInEarlier} chars, removed: ${earlier.length})`,
        `  • Initial user goal: ${goal}`,
        `  • Current working directory: ${ctx.cwd ?? '(unknown)'}`,
        `  • Retained tail: last ${tail.length} messages preserved verbatim. No further LLM calls used.`,
      ].join('\n'),
    });
    return { messages: [...markers, ...tail], removed: earlier.length, kept: markers.length + tail.length, report: `summary_inject: template goal+stats marker + keep last ${tail.length}` };
  }
}

// Strategy 3: LLM summarizer (optional, falls back gracefully) --------
export class LLMSummaryCompactor extends SessionCompactor {
  constructor(opts) {
    super({ name: 'summary_llm' });
    this.keepTail = opts?.keepTail ?? 4;
    this.maxInputChars = opts?.maxInputChars ?? 12_000;
  }
  get capabilities() { return Object.freeze({ canUseLLM: true }); }
  async compact(ctx) {
    const msgs = ctx.messages ?? [];
    const keep = Math.max(2, ctx.maxMessages ?? this.keepTail);
    if (msgs.length <= keep + 4) return { messages: msgs, removed: 0, kept: msgs.length, report: 'Too short to summarize' };
    const cutAt = msgs.length - keep;
    const earlier = msgs.slice(0, cutAt);
    const tail = msgs.slice(cutAt);
    // Serialize earlier messages into compact form
    let serialized = '';
    for (const m of earlier) {
      const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '');
      if (!text.trim()) continue;
      serialized += `[${m.role}] ${text.slice(0, 2000)}\n\n`;
      if (serialized.length > this.maxInputChars) {
        serialized += `[…${earlier.length - serialized.length / 2000 | 0} more messages truncated]`;
        break;
      }
    }
    const prompt = `You are compacting a coding conversation. Summarize ONLY the earlier turns below into:

1. **Goals** — what the user wanted, as bullet points (max 6)
2. **Key Decisions / Files Changed** — bullet list of important files and decisions (max 8)
3. **Open Questions / Blockers** — any unresolved points (max 4)
4. **State Preservation** — variables / context the assistant must remember (max 6)

Use markdown. Keep under 1200 words. Do NOT re-summarize anything not in the input.

## Current project directory
${ctx.cwd ?? '(unknown)'}

## Earlier conversation to summarize

${serialized.slice(0, this.maxInputChars)}

## Output format
Write ONLY a single markdown block with the 4 sections as headings.`;

    let summaryText;
    try {
      if (typeof ctx.llmSummary !== 'function') throw new Error('llmSummary not provided');
      summaryText = await ctx.llmSummary(prompt);
      if (typeof summaryText !== 'string' || !summaryText.trim()) throw new Error('llmSummary returned empty');
    } catch (err) {
      // Fallback to template strategy transparently
      const fb = new TemplateSummaryCompactor({ keepTail: keep });
      const r = await fb.compact(ctx);
      r.report += ' (LLM summary unavailable, fell back to summary_inject — ' + err.message + ')';
      return r;
    }
    const marker = {
      id: randomUUID(), role: 'system', timestamp: Date.now(),
      content: `[Conversation compacted by summary_llm strategy: ${earlier.length} messages -> LLM summary]\n\n${summaryText}`,
    };
    return { messages: [marker, ...tail], removed: earlier.length, kept: 1 + tail.length, report: `summary_llm: ${earlier.length}→1 (LLM OK), kept ${tail.length} tail` };
  }
}

// Strategy 4: Hybrid ---------------------------------------------------
// If messages < 40 → keep_last(keep=16) ; 40–200 → summary_inject ; >200 → summary_llm (if available) else inject
export class HybridCompactor extends SessionCompactor {
  constructor(opts) {
    super({ name: 'hybrid' });
    this.keep = new KeepLastCompactor({ keep: opts?.keepSmall ?? 16 });
    this.tpl  = new TemplateSummaryCompactor({ keepTail: opts?.keepMedium ?? 10 });
    this.llm  = new LLMSummaryCompactor({ keepTail: opts?.keepLarge ?? 6 });
  }
  get capabilities() { return Object.freeze({ canUseLLM: true }); }
  async compact(ctx) {
    const len = (ctx.messages ?? []).length;
    if (len < 40) return this.keep.compact({ ...ctx, maxMessages: this.keep.keep });
    if (len < 200) return this.tpl.compact(ctx);
    return this.llm.compact(ctx);
  }
}

// ---------------------------------------------------------------------
// Registry
export class CompactionRegistry {
  constructor() {
    this._strategies = new Map();
    this._default = 'hybrid';
    this.register('keep_last',      () => new KeepLastCompactor());
    this.register('summary_inject', () => new TemplateSummaryCompactor());
    this.register('summary_llm',    () => new LLMSummaryCompactor());
    this.register('hybrid',         () => new HybridCompactor());
    // usage stats for observability
    this._usage = new Map();
  }
  register(name, factory, opts) {
    if (typeof factory !== 'function') throw new Error('[compaction] factory must be a function that returns SessionCompactor');
    this._strategies.set(name, { factory, opts: Object.freeze({ ...(opts ?? {}) }) });
    return () => this._strategies.delete(name);
  }
  list() {
    return Array.from(this._strategies.entries()).map(([name, def]) => {
      try { const inst = def.factory(); return { name, opts: def.opts, capabilities: inst.capabilities, usage: this._usage.get(name) ?? 0 }; }
      catch { return { name, opts: def.opts, usage: this._usage.get(name) ?? 0 }; }
    });
  }
  setDefault(name) {
    if (!this._strategies.has(name)) throw new Error(`[compaction] unknown strategy: ${name}`);
    this._default = name;
  }
  get defaultName() { return this._default; }
  get(nameOrNull) {
    const name = nameOrNull ?? this._default;
    const def = this._strategies.get(name);
    if (!def) throw new Error(`[compaction] unknown strategy: ${name}`);
    const inst = def.factory();
    return { name, instance: inst, opts: def.opts };
  }
  // Run strategy with name override
  async run(ctx, opts) {
    const want = opts?.strategy ?? this._default;
    const { name, instance } = this.get(want);
    const start = Date.now();
    const result = await instance.compact(ctx);
    const ms = Date.now() - start;
    this._usage.set(name, (this._usage.get(name) ?? 0) + 1);
    this._saveUsage();
    return { strategy: name, durationMs: ms, ...result };
  }
  _saveUsage() {
    try {
      const dir = STATE_DIR();
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'usage.json'), JSON.stringify(Object.fromEntries(this._usage), null, 2));
    } catch {}
  }
  loadUsage() {
    try {
      const f = join(STATE_DIR(), 'usage.json');
      if (!existsSync(f)) return {};
      const obj = JSON.parse(readFileSync(f, 'utf8'));
      for (const [k,v] of Object.entries(obj)) if (typeof v === 'number') this._usage.set(k, v);
      return Object.fromEntries(this._usage);
    } catch { return {}; }
  }
}

export const compactionRegistry = new CompactionRegistry();
compactionRegistry.loadUsage();
