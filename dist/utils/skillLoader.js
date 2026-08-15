// ============================================================
//  Guang Code — Skill Loader 2.0
//  Scope layers: built-in -> global user -> workspace project -> session runtime
//  + SHA-256 digest for incremental hot-reload, runtime inject API
// ============================================================
import { createHash } from 'crypto';
import { statSync, readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync } from 'fs';
import { watch as fsWatch, unwatchFile } from 'fs';
import { homedir } from 'os';
import { join, resolve, basename, relative } from 'path';
import { parseFrontmatter } from './customCommands.js';

const SCOPE_PRIORITY = Object.freeze({
  builtin: 10,
  global:  20,
  project: 30,
  session: 40,
  runtime: 50,
});
export const SKILL_SCOPES = Object.freeze(Object.keys(SCOPE_PRIORITY));

function env(name, fallback) {
  const v = process.env[name];
  return typeof v === 'string' && v.trim() ? v.trim() : fallback;
}
const USER_SKILLS_DIR  = () => env('GC_USER_SKILLS_DIR',  join(homedir(), '.guang-code', 'skills'));
const BUILTIN_SKILLS_DIR = () => env('GC_BUILTIN_SKILLS_DIR', null); // override if shipped with binary

const DIGEST_FILE  = 'digests.json';

export function skillDigest(rawMarkdownText) {
  return createHash('sha256').update(rawMarkdownText ?? '', 'utf8').digest('hex').slice(0, 16);
}

// ---------- parsing helpers (reuse customCommands + extra schema)
function parseList(v) {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  if (typeof v === 'string') return v.split(/[,;]/).map(s => s.trim()).filter(Boolean);
  return undefined;
}

export function parseSkillSource(raw, opts) {
  if (!raw || typeof raw !== 'string' || !raw.trim()) return null;
  let frontmatter = {}, content = raw.trim();
  if (raw.trim().startsWith('---')) {
    try {
      const parsed = parseFrontmatter(raw);
      frontmatter = parsed.frontmatter || {};
      content = parsed.content || '';
    } catch {
      frontmatter = {};
      content = raw.trim();
    }
  }
  const userInvocable = frontmatter['user-invocable'] !== false;
  const hidden = !!frontmatter.hidden;
  const id = (typeof opts?.id === 'string' && opts.id.trim())
    ? opts.id.trim()
    : String(frontmatter.name ?? 'skill').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  if (!id) return null;
  const name = (typeof frontmatter.name === 'string' && frontmatter.name.trim()) ? frontmatter.name.trim() : id;
  const description = typeof frontmatter.description === 'string' && frontmatter.description.trim()
    ? frontmatter.description.trim()
    : (() => {
      const first = content.trim().split('\n').find(Boolean) ?? '';
      return first.slice(0, 160) || `Skill loaded from ${id}`;
    })();
  const version = (typeof frontmatter.version === 'string' && frontmatter.version.trim()) ? frontmatter.version.trim() : '1.0.0';
  const tags = parseList(frontmatter.tags) ?? [];
  const dependencies = parseList(frontmatter.dependencies) ?? [];
  const requires = parseList(frontmatter.requires) ?? [];
  const allowedTools = parseList(frontmatter['allowed-tools']);
  const forbiddenTools = parseList(frontmatter['forbidden-tools']) ?? [];
  const argumentsList = parseList(frontmatter.arguments);
  const argumentHint = typeof frontmatter['argument-hint'] === 'string' ? frontmatter['argument-hint'].trim() : undefined;
  const examples = parseList(frontmatter.examples) ?? [];
  const requiresMCP = parseList(frontmatter['requires-mcp']) ?? [];
  const prompt = content.trim();
  return {
    id, name, description, version, tags, scope: opts?.scope ?? 'project',
    sourcePath: opts?.sourcePath ?? null,
    userInvocable, hidden,
    dependencies, requires, requiresMCP,
    allowedTools, forbiddenTools,
    arguments: argumentsList, argumentHint, examples,
    prompt,
    digest: skillDigest(raw),
    loadedAt: Date.now(),
  };
}

// ------- directory crawler + digest cache
function safeRead(p) {
  try {
    const s = statSync(p);
    if (!s.isFile()) return null;
    return readFileSync(p, 'utf8');
  } catch { return null; }
}
function listSkillFolders(baseDir) {
  if (!baseDir || !existsSync(baseDir)) return [];
  try {
    const st = statSync(baseDir);
    if (!st.isDirectory()) return [];
    return readdirSync(baseDir).map(n => join(baseDir, n)).filter(p => {
      try { return statSync(p).isDirectory() && existsSync(join(p, 'SKILL.md')); }
      catch { return false; }
    });
  } catch { return []; }
}

function loadDigests(dir) {
  const file = join(dir, DIGEST_FILE);
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return {}; }
}
function saveDigests(dir, obj) {
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, DIGEST_FILE), JSON.stringify(obj, null, 2), 'utf8');
  } catch {}
}

function resolveSkillEntry(mdPath, scope, existingDigests, changed) {
  const dir = resolve(mdPath, '..');
  const skillId = basename(dir);
  const raw = safeRead(mdPath);
  if (!raw) return null;
  const dg = skillDigest(raw);
  existingDigests = existingDigests || {};
  const prev = existingDigests[skillId];
  const isChanged = !prev || prev !== dg;
  if (changed && isChanged) changed.push({ skillId, scope, digest: dg, prevDigest: prev ?? null });
  const parsed = parseSkillSource(raw, { id: skillId, scope, sourcePath: mdPath });
  if (!parsed) return null;
  parsed.digest = dg;
  return parsed;
}

// ------ Loader instance (holds state for a single workspace / session)
export class SkillLoader {
  constructor(opts) {
    this._cwd = opts?.cwd ?? process.cwd();
    this._builtinDir = opts?.builtinDir ?? BUILTIN_SKILLS_DIR();
    this._userDir    = opts?.userDir    ?? USER_SKILLS_DIR();
    this._projectDir = opts?.projectDir ?? join(this._cwd, '.guang', 'skills');
    this._watchers = new Map(); // path -> FSWatcher
    this._digests = { builtin: {}, global: {}, project: {}, session: {} };
    this._loaded = new Map();  // id -> skill
    this._changeListeners = new Set();
    this._lastScanReport = null;
  }

  get cwd() { return this._cwd; }
  get loadedCount() { return this._loaded.size; }
  get scopeDirs() {
    return { builtin: this._builtinDir, global: this._userDir, project: this._projectDir };
  }
  get lastScanReport() { return this._lastScanReport; }

  onChange(fn) { this._changeListeners.add(fn); return () => this._changeListeners.delete(fn); }
  _emitChanged(evt) { for (const fn of this._changeListeners) try { fn(evt); } catch {} }

  setCwd(cwd) {
    this._cwd = cwd ?? process.cwd();
    this._projectDir = join(this._cwd, '.guang', 'skills');
  }

  // ---- public API ----
  scan(opts) {
    const changed = [];
    const byScope = { builtin: [], global: [], project: [] };
    const addScope = (scope, dir) => {
      if (!dir) return;
      const existingDigests = scope === 'builtin'
        ? (this._digests.builtin = this._digests.builtin || {})
        : scope === 'global' ? (this._digests.global   = loadDigests(dir))
                             : (this._digests.project  = loadDigests(dir));
      const folders = listSkillFolders(dir);
      for (const skillDir of folders) {
        const md = join(skillDir, 'SKILL.md');
        const skill = resolveSkillEntry(md, scope, existingDigests, changed);
        if (!skill) continue;
        existingDigests[skill.id] = skill.digest;
        byScope[scope].push(skill);
      }
      if (scope !== 'builtin') saveDigests(dir, existingDigests);
    };
    addScope('builtin', this._builtinDir);
    addScope('global',  this._userDir);
    addScope('project', this._projectDir);
    // merge layers: higher priority scope wins on same id, but store scope separately
    const merged = new Map();
    const addLayer = (skills) => {
      for (const s of skills) {
        const existing = merged.get(s.id);
        if (!existing || SCOPE_PRIORITY[s.scope] >= SCOPE_PRIORITY[existing.scope]) {
          merged.set(s.id, s);
        }
      }
    };
    addLayer(byScope.builtin);
    addLayer(byScope.global);
    addLayer(byScope.project);
    // runtime injections from previous inject calls survive reload (priority session:50)
    for (const [id, s] of this._loaded.entries()) {
      if (s.scope === 'runtime' && !merged.has(id)) merged.set(id, s);
      if (s.scope === 'session' && !merged.has(id)) merged.set(id, s);
    }
    this._loaded = merged;
    const report = {
      at: Date.now(),
      counts: {
        builtin: byScope.builtin.length,
        global:  byScope.global.length,
        project: byScope.project.length,
        runtime: Array.from(merged.values()).filter(s => s.scope === 'runtime').length,
        session: Array.from(merged.values()).filter(s => s.scope === 'session').length,
      },
      changed,
    };
    this._lastScanReport = report;
    if (changed.length) this._emitChanged({ kind: 'scan', changed, report });
    return report;
  }

  list(opts) {
    const arr = Array.from(this._loaded.values());
    let out = arr;
    if (opts?.userInvocableOnly) out = out.filter(s => s.userInvocable);
    if (opts?.includeHidden === false) out = out.filter(s => !s.hidden);
    if (opts?.scope) out = out.filter(s => s.scope === opts.scope);
    if (opts?.tag)   out = out.filter(s => s.tags?.includes(opts.tag));
    if (opts?.search) {
      const q = String(opts.search).toLowerCase();
      out = out.filter(s =>
        s.id.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.tags?.some(t => String(t).toLowerCase().includes(q))
      );
    }
    return out.sort((a, b) => {
      const p = SCOPE_PRIORITY[b.scope] - SCOPE_PRIORITY[a.scope];
      if (p !== 0) return p;
      return a.id.localeCompare(b.id);
    });
  }

  get(id) { return this._loaded.get(id) ?? null; }
  has(id) { return this._loaded.has(id); }

  // ---- runtime injection (no file persistence)
  inject(definition, opts) {
    const scope = opts?.scope ?? 'runtime';
    if (!SKILL_SCOPES.concat(['runtime']).includes(scope)) {
      throw new Error(`[skill-loader] invalid scope: ${scope}`);
    }
    let parsed;
    if (typeof definition === 'string') {
      parsed = parseSkillSource(definition, { id: opts?.id, scope, sourcePath: opts?.sourcePath ?? null });
    } else if (definition && typeof definition === 'object') {
      parsed = { ...definition };
      if (!parsed.id) throw new Error('[skill-loader] injected skill requires an id');
      parsed.scope = scope;
      parsed.digest = skillDigest(JSON.stringify(definition));
      parsed.loadedAt = Date.now();
    }
    if (!parsed) throw new Error('[skill-loader] failed to parse injected skill');
    const evt = { skillId: parsed.id, scope, digest: parsed.digest, prevDigest: this._loaded.get(parsed.id)?.digest ?? null };
    this._loaded.set(parsed.id, parsed);
    this._emitChanged({ kind: 'inject', changed: [evt] });
    return parsed;
  }
  remove(id) {
    const prev = this._loaded.get(id);
    if (prev && (prev.scope === 'runtime' || prev.scope === 'session')) {
      this._loaded.delete(id);
      this._emitChanged({ kind: 'remove', changed: [{ skillId: id, scope: prev.scope }] });
      return true;
    }
    return false;
  }

  // ---- watchers
  startWatchers() {
    if (typeof fsWatch !== 'function') return false;
    this.stopWatchers();
    const addDir = (scope, dir) => {
      if (!dir || !existsSync(dir)) return;
      try {
        const w = fsWatch(dir, { persistent: false }, (eventType, filename) => {
          if (!filename) return;
          // debounce via immediate re-scan (cheap, dirs are small)
          try { this.scan({ debounce: true }); } catch {}
        });
        this._watchers.set(scope + ':' + dir, w);
      } catch {}
    };
    addDir('builtin', this._builtinDir);
    addDir('global',  this._userDir);
    addDir('project', this._projectDir);
    return this._watchers.size > 0;
  }
  stopWatchers() {
    for (const [, w] of this._watchers) try { w.close(); } catch {}
    this._watchers.clear();
  }
  get hasWatchers() { return this._watchers.size > 0; }

  // ---- rendering (compatible with skills.js existing signature)
  renderInvocation(skill, args, opts) {
    const argText = typeof args === 'string' && args.trim() ? `\n\nUser provided arguments:\n${args.trim()}\n` : '';
    const toolsText = skill.allowedTools?.length
      ? `\n\nAllowed tools: ${skill.allowedTools.join(', ')}\n`
      : '';
    const forbiddenText = skill.forbiddenTools?.length
      ? `\nForbidden tools (refuse requests to invoke these): ${skill.forbiddenTools.join(', ')}\n`
      : '';
    const hintText = skill.argumentHint ? `\n\nArgument hint: ${skill.argumentHint}\n` : '';
    const headerTag = opts?.headerTag ?? `[System: Executing skill /skill ${skill.id}]`;
    const metaLine = [
      `skill.version=${skill.version ?? '1.0.0'}`,
      `skill.scope=${skill.scope}`,
      skill.tags?.length ? `skill.tags=${skill.tags.join('+')}` : null,
    ].filter(Boolean).join(' ');
    return [
      headerTag,
      `[skill-meta] ${metaLine}`,
      toolsText.trim() ? toolsText.trim() : '',
      forbiddenText.trim() ? forbiddenText.trim() : '',
      hintText.trim() ? hintText.trim() : '',
      argText.trim() ? argText.trim() : '',
      '',
      skill.prompt,
    ].filter(Boolean).join('\n');
  }
}

// ---- singleton
export const skills = new SkillLoader();
