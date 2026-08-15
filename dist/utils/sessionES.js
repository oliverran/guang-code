// ============================================================
//  Guang Code — Event Sourced Session Store
//  SessionEvent (JSONL append-only) + projection cache + fork
// ============================================================
import { createHash, randomUUID } from 'crypto';
import { appendFile, mkdir, readFile, writeFile, readdir, stat, unlink, rename, lstat } from 'fs/promises';
import { createReadStream, createWriteStream, existsSync, mkdirSync } from 'fs';
import { createBrotliDecompress, createBrotliCompress } from 'zlib';
import { homedir } from 'os';
import { join, basename } from 'path';
import { pipeline } from 'stream/promises';

function env(name, fallback) {
  const v = process.env[name];
  return typeof v === 'string' && v.trim() ? v.trim() : fallback;
}

const BASE_DIR = () => env('GC_SESSION_DIR', join(homedir(), '.guang-code', 'sessions-es'));
const EVENT_FILE  = 'events.jsonl';
const PROJECTION_FILE = 'projection.json';
const SNAPSHOT_EVERY = 100;

export const SESSION_EVENT_TYPES = Object.freeze([
  'SessionCreated','SessionMetadataChanged','SessionArchived','SessionForked',
  'MessageAdded','MessageRemoved','MessageEdited','MessagesTrimmed',
  'ToolCallInitiated','ToolCallCompleted','ToolCallFailed',
  'ToolPermissionGranted','ToolPermissionDenied',
  'SkillInvoked','SkillCompleted',
  'MemoryWritten','MemoryQueried','MemoryRemoved',
  'HookTriggered','HookFailed',
  'BudgetExceeded','SessionCompleted',
]);

function makeEvent(sessionId, type, payload, opts) {
  if (!SESSION_EVENT_TYPES.includes(type)) {
    throw new Error(`[session-es] Unknown event type: ${type}`);
  }
  return {
    id: randomUUID(),
    sessionId,
    type,
    payload: payload ?? {},
    ts: Date.now(),
    seq: 0,
    prevHash: opts?.prevHash ?? null,
  };
}

function hashEvent(e) {
  const s = `${e.id}|${e.sessionId}|${e.type}|${e.seq}|${e.ts}|${JSON.stringify(e.payload)}|${e.prevHash ?? ''}`;
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

function sessionDir(id, base) { return join(base, id); }

async function ensureDirP(p) {
  try { await mkdir(p, { recursive: true }); } catch { /* already exists */ }
}

// ---------- Projector (pure reducer over events) -------------------
export function createEmptyProjection(sessionId, cwd) {
  return {
    sessionId,
    cwd: cwd ?? null,
    version: 1,
    lastEventSeq: 0,
    lastEventHash: null,
    created: null,
    updated: null,
    archived: false,
    forkedFrom: null,
    title: null,
    tags: new Set(),
    metadata: {},
    messages: [],               // {id, role, content, timestamp, toolUseId?}
    messagesIndex: new Map(),   // id -> index in messages
    stats: {
      totalEvents: 0,
      turns: 0,
      toolCalls: 0,
      toolCallFailures: 0,
      memoryWrites: 0,
      tokensInput: 0, tokensOutput: 0,
      lastToolCall: null,
    },
    toolPermissions: new Map(), // toolName -> {granted:boolean, count, lastAt}
    skillsInvoked: new Map(),   // skillId -> count
    lastUserMessage: null,
  };
}

function cloneProjForImmutability(p) {
  // shallow-clone surfaces + new Sets/Maps so caller can mutate
  return {
    ...p,
    tags: new Set(p.tags),
    metadata: { ...p.metadata },
    messages: p.messages.slice(),
    messagesIndex: new Map(p.messagesIndex),
    stats: { ...p.stats },
    toolPermissions: new Map(p.toolPermissions),
    skillsInvoked: new Map(p.skillsInvoked),
  };
}

export function applyEvent(projection, ev) {
  if (ev.sessionId !== projection.sessionId) return projection;
  if (ev.seq > 0 && ev.seq !== projection.lastEventSeq + 1) {
    throw new Error(`[session-es] seq gap: expect ${projection.lastEventSeq+1}, got ${ev.seq}`);
  }
  const p = cloneProjForImmutability(projection);
  p.lastEventSeq = ev.seq;
  p.lastEventHash = ev._hash ?? hashEvent(ev);
  p.stats.totalEvents++;
  p.updated = ev.ts;

  switch (ev.type) {
    case 'SessionCreated': {
      p.created = ev.ts;
      p.title = ev.payload?.title ?? null;
      p.cwd = ev.payload?.cwd ?? p.cwd;
      if (Array.isArray(ev.payload?.tags)) ev.payload.tags.forEach(t => p.tags.add(t));
      if (ev.payload?.metadata && typeof ev.payload.metadata === 'object') {
        p.metadata = { ...p.metadata, ...ev.payload.metadata };
      }
      break;
    }
    case 'SessionMetadataChanged': {
      if (typeof ev.payload?.title === 'string') p.title = ev.payload.title;
      if (Array.isArray(ev.payload?.tags)) {
        p.tags.clear();
        ev.payload.tags.forEach(t => p.tags.add(t));
      }
      if (ev.payload?.metadata && typeof ev.payload.metadata === 'object') {
        p.metadata = { ...p.metadata, ...ev.payload.metadata };
      }
      break;
    }
    case 'SessionArchived': p.archived = true; break;
    case 'SessionForked':   p.forkedFrom = ev.payload?.fromSessionId ?? null; break;

    case 'MessageAdded': {
      const m = ev.payload?.message;
      if (m && typeof m === 'object') {
        p.messages.push(m);
        p.messagesIndex.set(m.id, p.messages.length - 1);
        if (m.role === 'user') {
          p.lastUserMessage = m;
          p.stats.turns++;
        }
      }
      break;
    }
    case 'MessageRemoved': {
      const id = ev.payload?.id;
      if (id && p.messagesIndex.has(id)) {
        const idx = p.messagesIndex.get(id);
        p.messages.splice(idx, 1);
        // rebuild index
        p.messagesIndex.clear();
        p.messages.forEach((mm, i) => p.messagesIndex.set(mm.id, i));
      }
      break;
    }
    case 'MessageEdited': {
      const id = ev.payload?.id;
      if (id && p.messagesIndex.has(id)) {
        const idx = p.messagesIndex.get(id);
        p.messages[idx] = { ...p.messages[idx], ...(ev.payload.patch ?? {}) };
      }
      break;
    }
    case 'MessagesTrimmed': {
      const keepFrom = ev.payload?.keepFrom ?? 0;
      if (keepFrom > 0) {
        p.messages = p.messages.slice(keepFrom);
        p.messagesIndex.clear();
        p.messages.forEach((mm, i) => p.messagesIndex.set(mm.id, i));
      }
      break;
    }
    case 'ToolCallInitiated': p.stats.toolCalls++; p.stats.lastToolCall = { name: ev.payload?.name, id: ev.payload?.id, at: ev.ts }; break;
    case 'ToolCallFailed':    p.stats.toolCallFailures++; break;
    case 'ToolCallCompleted':
    case 'ToolPermissionGranted':
    case 'ToolPermissionDenied': {
      const name = ev.payload?.name;
      if (name) {
        const prev = p.toolPermissions.get(name) ?? { granted: 0, denied: 0, completed: 0, failed: 0, lastAt: 0 };
        if (ev.type === 'ToolPermissionGranted') prev.granted++;
        if (ev.type === 'ToolPermissionDenied')  prev.denied++;
        if (ev.type === 'ToolCallCompleted')     prev.completed++;
        if (ev.type === 'ToolCallFailed')        prev.failed++;
        prev.lastAt = ev.ts;
        p.toolPermissions.set(name, prev);
      }
      break;
    }
    case 'SkillInvoked': {
      const id = ev.payload?.skillId;
      if (id) p.skillsInvoked.set(id, (p.skillsInvoked.get(id) ?? 0) + 1);
      break;
    }
    case 'SkillCompleted': break;

    case 'MemoryWritten': p.stats.memoryWrites++; break;
    case 'MemoryQueried':
    case 'MemoryRemoved': break;

    case 'BudgetExceeded':
      if (typeof ev.payload?.tokensInput  === 'number') p.stats.tokensInput  += ev.payload.tokensInput;
      if (typeof ev.payload?.tokensOutput === 'number') p.stats.tokensOutput += ev.payload.tokensOutput;
      break;
    case 'SessionCompleted':
      if (typeof ev.payload?.tokensInput  === 'number') p.stats.tokensInput  = ev.payload.tokensInput;
      if (typeof ev.payload?.tokensOutput === 'number') p.stats.tokensOutput = ev.payload.tokensOutput;
      break;
    case 'HookTriggered':
    case 'HookFailed': break;
  }
  return p;
}

function serializeProjection(p) {
  return {
    ...p,
    tags: Array.from(p.tags),
    messagesIndex: Array.from(p.messagesIndex.entries()),
    toolPermissions: Array.from(p.toolPermissions.entries()),
    skillsInvoked:   Array.from(p.skillsInvoked.entries()),
    __serializeAs: 'session-projection-v1',
  };
}
function deserializeProjection(obj) {
  if (!obj || obj.__serializeAs !== 'session-projection-v1') {
    // not a valid serialized projection (old snapshot). treat as full messages only.
    const np = createEmptyProjection(obj?.sessionId ?? 'restore', obj?.cwd ?? null);
    if (Array.isArray(obj?.messages)) {
      for (const m of obj.messages) {
        np.messages.push(m);
        np.messagesIndex.set(m.id, np.messages.length - 1);
      }
    }
    np.updated = obj?.updated ?? Date.now();
    np.created = obj?.created ?? np.updated;
    np.title   = obj?.title ?? null;
    np.archived = !!obj?.archived;
    np.lastUserMessage = np.messages.filter(m => m.role === 'user').pop() ?? null;
    return np;
  }
  return {
    ...obj,
    tags: new Set(obj.tags ?? []),
    messagesIndex: new Map(obj.messagesIndex ?? []),
    toolPermissions: new Map(obj.toolPermissions ?? []),
    skillsInvoked:   new Map(obj.skillsInvoked   ?? []),
  };
}

// ---------- Store ------------------------------------------------
export class SessionEventStore {
  constructor(opts) {
    this._base = opts?.baseDir ?? BASE_DIR();
    this._open = new Map();
    this._subscribers = new Map(); // sessionId -> Set<fn>
    this._globalSubs = new Set();
  }

  get baseDir() { return this._base; }

  // lifecycle subscribers
  onEvent(handler) {
    this._globalSubs.add(handler);
    return () => this._globalSubs.delete(handler);
  }
  onSessionEvent(sessionId, handler) {
    if (!this._subscribers.has(sessionId)) this._subscribers.set(sessionId, new Set());
    this._subscribers.get(sessionId).add(handler);
    return () => this._subscribers.get(sessionId)?.delete(handler);
  }
  _emit(sess, ev) {
    this._globalSubs.forEach(fn => safeCall(fn, sess, ev));
    this._subscribers.get(sess)?.forEach(fn => safeCall(fn, ev));
  }

  async init() { await ensureDirP(this._base); }

  // ---- lifecycle
  async newSession(cwd, opts) {
    await this.init();
    const id = opts?.id ?? randomUUID();
    const dir = sessionDir(id, this._base);
    await ensureDirP(dir);
    const ev = makeEvent(id, 'SessionCreated', {
      cwd,
      title: opts?.title ?? null,
      tags: opts?.tags ?? [],
      metadata: opts?.metadata ?? {},
    });
    await this.appendEvent(id, ev);
    return id;
  }

  async appendEvent(sessionId, ev) {
    const key = sessionId;
    const state = this._open.get(key) ?? { seq: 0, lastHash: null, dirty: 0, dir: sessionDir(sessionId, this._base) };
    await ensureDirP(state.dir);
    const num = ev;
    num.sessionId = sessionId;
    num.seq = (num.seq > 0) ? num.seq : state.seq + 1;
    num.prevHash = num.prevHash ?? state.lastHash;
    num._hash = hashEvent(num);

    const line = JSON.stringify(num) + '\n';
    await appendFile(join(state.dir, EVENT_FILE), line, 'utf8');

    state.seq = num.seq;
    state.lastHash = num._hash;
    state.dirty++;
    this._open.set(key, state);

    // emit
    this._emit(sessionId, num);

    // periodic snapshot
    if (state.dirty >= SNAPSHOT_EVERY) {
      const proj = await this.getProjection(sessionId);
      await this.writeSnapshot(sessionId, proj);
      state.dirty = 0;
    }

    // also: keep legacy session JSON in sync for users on older version (dual write)
    await this._writeLegacySync(sessionId);
    return num;
  }

  async listSessions() {
    await this.init();
    const out = [];
    let files = [];
    try { files = await readdir(this._base); } catch { return []; }
    for (const name of files) {
      const full = join(this._base, name);
      let s;
      try { s = await lstat(full); } catch { continue; }
      if (!s.isDirectory()) continue;
      const p = await this._tryLoadProjectionFromSnapshot(name);
      if (p) {
        out.push({
          id: name,
          title: p.title,
          cwd: p.cwd,
          created: p.created,
          updated: p.updated,
          archived: p.archived,
          forkedFrom: p.forkedFrom,
          messageCount: p.messages.length,
          totalEvents: p.stats.totalEvents,
          tokensInput: p.stats.tokensInput,
          tokensOutput: p.stats.tokensOutput,
        });
      } else {
        out.push({ id: name, updated: s.mtimeMs });
      }
    }
    return out.sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0));
  }

  async readEvents(sessionId, fromSeqInclusive = 1) {
    const dir = sessionDir(sessionId, this._base);
    const events = [];
    try {
      const lines = (await readFile(join(dir, EVENT_FILE), 'utf8')).split('\n');
      for (const ln of lines) {
        if (!ln.trim()) continue;
        try {
          const e = JSON.parse(ln);
          if (e.seq >= fromSeqInclusive) events.push(e);
        } catch { /* skip corrupt line */ }
      }
    } catch { /* file missing: no events yet */ }
    // also read archived segments: events.<n>.jsonl.br (brotli)
    try {
      const all = await readdir(dir);
      const archived = all.filter(n => /^events\.\d+\.jsonl\.br$/.test(n)).sort();
      for (const a of archived) {
        const idx = Number(a.match(/\.(\d+)\./)[1]);
        const maxSeq = idx * 1000;
        if (maxSeq < fromSeqInclusive) continue;
        const plainPath = join(dir, a + '.decoded.jsonl');
        try {
          await pipeline(createReadStream(join(dir, a)), createBrotliDecompress(), createWriteStream(plainPath));
          const lines = (await readFile(plainPath, 'utf8')).split('\n');
          for (const ln of lines) {
            if (!ln.trim()) continue;
            try {
              const e = JSON.parse(ln);
              if (e.seq >= fromSeqInclusive) events.push(e);
            } catch {}
          }
        } catch {}
        try { await unlink(plainPath); } catch {}
      }
    } catch {}
    return events.sort((a, b) => a.seq - b.seq);
  }

  async getProjection(sessionId) {
    const snap = await this._tryLoadProjectionFromSnapshot(sessionId);
    const base = snap ?? createEmptyProjection(sessionId, null);
    const events = await this.readEvents(sessionId, base.lastEventSeq + 1);
    let cur = base;
    for (const e of events) cur = applyEvent(cur, e);
    return cur;
  }

  async writeSnapshot(sessionId, projection) {
    const dir = sessionDir(sessionId, this._base);
    await ensureDirP(dir);
    const tmp = join(dir, PROJECTION_FILE + '.tmp');
    const target = join(dir, PROJECTION_FILE);
    await writeFile(tmp, JSON.stringify(serializeProjection(projection)), 'utf8');
    await safeAtomicRename(tmp, target);
  }

  async _tryLoadProjectionFromSnapshot(sessionId) {
    const dir = sessionDir(sessionId, this._base);
    const file = join(dir, PROJECTION_FILE);
    try {
      const raw = await readFile(file, 'utf8');
      const obj = JSON.parse(raw);
      return deserializeProjection(obj);
    } catch {
      return null;
    }
  }

  // ---- fork
  async forkSession(fromId, opts) {
    await this.init();
    const from = await this.getProjection(fromId);
    if (!from || !from.created) throw new Error(`[session-es] source session ${fromId} not found`);
    const newId = opts?.id ?? randomUUID();
    await ensureDirP(sessionDir(newId, this._base));
    // copy snapshot first
    const baseProj = createEmptyProjection(newId, from.cwd);
    baseProj.forkedFrom = fromId;
    baseProj.messages = from.messages.slice(0, opts?.keepMessages ?? from.messages.length);
    baseProj.messages.forEach((m, i) => baseProj.messagesIndex.set(m.id, i));
    baseProj.title = opts?.title ?? from.title ? `${from.title ?? 'Session'} (fork)` : 'Forked session';
    baseProj.lastUserMessage = baseProj.messages.filter(m => m.role === 'user').pop() ?? null;
    baseProj.stats.turns = baseProj.messages.filter(m => m.role === 'user').length;
    await this.writeSnapshot(newId, baseProj);
    await this.appendEvent(newId, makeEvent(newId, 'SessionForked', { fromSessionId: fromId, keepMessages: baseProj.messages.length }));
    return newId;
  }

  // ---- archival: compact first N*1000 events into brotli segments
  async archiveEvents(sessionId) {
    const dir = sessionDir(sessionId, this._base);
    const events = await this.readEvents(sessionId);
    if (events.length < 2000) return { archived: 0 };
    // full multiples of 1000 (keep last partial window as events.jsonl)
    const keepFromSeq = Math.floor(events.length / 1000) * 1000;
    if (keepFromSeq <= 0) return { archived: 0 };
    const groups = new Map();
    for (const e of events) {
      if (e.seq > keepFromSeq) continue;
      const idx = Math.ceil(e.seq / 1000);
      if (!groups.has(idx)) groups.set(idx, []);
      groups.get(idx).push(e);
    }
    let archived = 0;
    for (const [idx, arr] of groups.entries()) {
      const segName = `events.${idx}.jsonl.br`;
      const tmp = join(dir, segName + '.tmp');
      const tmpPlain = join(dir, `events.${idx}.tmp.jsonl`);
      await writeFile(tmpPlain, arr.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');
      await pipeline(createReadStream(tmpPlain), createBrotliCompress(), createWriteStream(tmp));
      await safeAtomicRename(tmp, join(dir, segName));
      try { await unlink(tmpPlain); } catch {}
      archived += arr.length;
    }
    // rewrite events.jsonl with kept tail
    const keep = events.filter(e => e.seq > keepFromSeq);
    const tmp = join(dir, EVENT_FILE + '.tmp');
    await writeFile(tmp, keep.map(e => JSON.stringify(e)).join('\n') + (keep.length ? '\n' : ''), 'utf8');
    await safeAtomicRename(tmp, join(dir, EVENT_FILE));
    return { archived };
  }

  // ---- backward compatibility: dual-write a legacy *.json at ~/.guang-code/sessions/
  async _writeLegacySync(sessionId) {
    try {
      const proj = await this.getProjection(sessionId);
      const legacyDir = env('GC_LEGACY_SESSION_DIR', join(homedir(), '.guang-code', 'sessions'));
      await ensureDirP(legacyDir);
      const content = {
        id: sessionId,
        cwd: proj.cwd,
        title: proj.title,
        createdAt: proj.created,
        updatedAt: proj.updated,
        archived: proj.archived,
        messages: proj.messages,
        stats: {
          totalEvents: proj.stats.totalEvents,
          turns: proj.stats.turns,
          toolCalls: proj.stats.toolCalls,
          tokensInput: proj.stats.tokensInput,
          tokensOutput: proj.stats.tokensOutput,
        },
        __fromEventStore: true,
      };
      const tmp = join(legacyDir, `${sessionId}.json.tmp`);
      await writeFile(tmp, JSON.stringify(content, null, 2), 'utf8');
      await safeAtomicRename(tmp, join(legacyDir, `${sessionId}.json`));
    } catch { /* non-fatal */ }
  }

  // ---- housekeeping: close state for session (caller-triggered)
  unload(sessionId) {
    this._open.delete(sessionId);
    this._subscribers.delete(sessionId);
  }
}

export const sessionStore = new SessionEventStore();

// ---------- Helpers ------------------------------------------------
function safeCall(fn, ...args) { try { fn(...args); } catch { /* swallow subscriber error */ } }

async function safeAtomicRename(tmp, target) {
  try { await rename(tmp, target); }
  catch (e) {
    if (e?.code === 'EEXIST' || e?.code === 'EPERM') {
      try { await unlink(target); } catch {}
      try { await rename(tmp, target); } catch {}
    }
  }
}
