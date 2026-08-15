// ============================================================
//  Guang Code — Memory Domain: Structured KV for Memory Entries
// ============================================================
//
// This module is a thin adapter on top of storage/index.js that
// mirrors what memdir.js does today, but persists to the
// domain KV store instead of (or in addition to) raw markdown files.
//
// Transition strategy (progressive, no flags):
//   1. On first read: if legacy markdown exists AND KV is empty,
//      run the migration. KV then becomes the source of truth.
//   2. On write: dual-write both KV and legacy markdown until
//      the user runs `/memory compact-kv` explicitly to disable
//      legacy writes.
//   3. This module is intentionally sync-safe: memdir.js can
//      continue to exist side-by-side while we swap it out.

import { MemoryDomain, MEMORY_TYPES, storage } from './storage/index.js'
import {
  ENTRYPOINT_NAME,
  MAX_ENTRYPOINT_LINES,
  MAX_ENTRYPOINT_BYTES,
  MEMORY_FRONTMATTER_EXAMPLE,
  addMemory as legacyAdd,
  listMemoryEntries as legacyList,
  readMemoryFile as legacyRead,
  removeMemory as legacyRemove,
  loadMemoryForPrompt as legacyLoad,
  getProjectMemoryDir,
  ensureMemoryIndexExists,
  truncateEntrypointContent,
} from './memdir.js'

const TABLE = 'entries'
const TABLE_INDEX = 'indexLines'
const TABLE_STATS = 'stats'

// ── Public API: data types ────────────────────────────────────
export const MemoryType = Object.freeze({
  USER: 'user',
  FEEDBACK: 'feedback',
  PROJECT: 'project',
  REFERENCE: 'reference',
})

export function normalizeMemoryType(raw) {
  const t = String(raw ?? '').toLowerCase()
  if (MEMORY_TYPES.includes(t)) return t
  return 'project'
}

export async function migrateLegacyMarkdownToKV(cwd, opts = {}) {
  await storage.openAll()
  const legacyEntries = legacyList(cwd, { baseDir: opts?.baseDir })
  if (!Array.isArray(legacyEntries) || legacyEntries.length === 0) {
    await storage.updateGlobal(MemoryDomain, (g) => ({
      ...g,
      legacyMarkdownMigratedAt: Date.now(),
      legacyMarkdownMigratedCount: 0,
    }))
    return 0
  }

  const count = { inserted: 0, skipped: 0 }
  await storage.txn(MemoryDomain, [TABLE, TABLE_INDEX, TABLE_STATS], async (tx) => {
    const existing = new Set(await tx.scanKeys(TABLE))
    for (const e of legacyEntries) {
      if (existing.has(e.id)) { count.skipped++; continue }
      const body = legacyRead(cwd, e.id, { baseDir: opts?.baseDir }) ?? ''
      await tx.put(TABLE, e.id, {
        id: e.id,
        type: normalizeMemoryType(e.type),
        name: String(e.name ?? ''),
        description: String(e.description ?? ''),
        tags: [],
        content: String(body),
        source: 'legacy-markdown',
        createdAt: Number(e.createdAt) || Date.now(),
        updatedAt: Number(e.createdAt) || Date.now(),
        legacyFilePath: e.filePath ?? null,
      })
      count.inserted++
    }
    // Rebuild index lines in insertion order (newest first, keep 200)
    await tx.clear(TABLE_INDEX)
    const all = await tx.scan(TABLE)
    const sorted = all
      .map(([, v]) => v)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, MAX_ENTRYPOINT_LINES)
    for (let i = 0; i < sorted.length; i++) {
      await tx.put(TABLE_INDEX, String(i + 1), { id: sorted[i].id, seq: i + 1 })
    }
    await tx.put(TABLE_STATS, 'summary', {
      entriesTotal: (await tx.scanKeys(TABLE)).length,
      lastMigrationAt: Date.now(),
      legacyMarkdownMigratedAt: Date.now(),
    })
  })

  await storage.updateGlobal(MemoryDomain, (g) => ({
    ...g,
    legacyMarkdownMigratedAt: Date.now(),
    legacyMarkdownMigratedCount: count.inserted,
  }))
  return count.inserted
}

// ── Core operations ───────────────────────────────────────────
function makeEntryId(name, suffix = null) {
  const clean = (name || 'memory')
    .trim().toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '') || 'memory'
  const rand = (suffix ?? Math.random().toString(36).slice(2, 10))
  return `${clean}-${rand}.md`
}

export async function listEntriesKV(cwd, opts = {}) {
  await storage.openAll()
  // If no migration has happened yet, do one lazily.
  const g = await storage.getGlobal(MemoryDomain)
  if (!g || !g.legacyMarkdownMigratedAt) {
    try { await migrateLegacyMarkdownToKV(cwd, opts) } catch { /* ignore */ }
  }
  const rows = await storage.scan(MemoryDomain, TABLE)
  const values = rows.map(([, v]) => v)
  values.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  if (opts?.type) {
    const t = normalizeMemoryType(opts.type)
    return values.filter((v) => v.type === t)
  }
  return values
}

export async function getEntryKV(cwd, id, opts = {}) {
  await storage.openAll()
  const row = await storage.get(MemoryDomain, TABLE, String(id))
  if (row) return row
  // Fallback to legacy (migration not yet run, or file was added outside KV)
  const body = legacyRead(cwd, id, opts)
  if (!body) return null
  const all = legacyList(cwd, opts)
  const meta = all.find((m) => m.id === id) ?? {}
  return {
    id,
    type: normalizeMemoryType(meta.type),
    name: String(meta.name ?? ''),
    description: String(meta.description ?? ''),
    tags: [],
    content: body,
    source: 'legacy-markdown-fallback',
    createdAt: Number(meta.createdAt) || Date.now(),
    updatedAt: Number(meta.createdAt) || Date.now(),
  }
}

/** Add a new memory entry — dual-write KV + legacy markdown. */
export async function addEntryKV(cwd, opts = {}) {
  await storage.openAll()
  const type = normalizeMemoryType(opts.type)
  const name = String(opts.name ?? '').trim() || String((opts.body ?? '').split('\n').find(Boolean) || '').slice(0, 80) || 'Memory'
  const description = String(opts.description ?? '').trim()
  const body = String(opts.body ?? '').trim()

  if (!body) throw new Error('Memory body is required')

  // Step 1: legacy write first (it can throw on secrets detection — bail out before KV)
  let legacyResult = null
  let failedLegacy = null
  try {
    legacyResult = legacyAdd(cwd, {
      type,
      name,
      description,
      body,
      baseDir: opts?.baseDir,
    })
  } catch (e) {
    failedLegacy = e
  }
  if (failedLegacy) throw failedLegacy

  // Step 2: KV write. Use the legacy ID so both sides agree.
  const id = legacyResult?.id ?? makeEntryId(name)
  const now = Date.now()
  await storage.txn(MemoryDomain, [TABLE, TABLE_INDEX, TABLE_STATS], async (tx) => {
    await tx.put(TABLE, id, {
      id, type, name, description,
      content: body,
      tags: Array.isArray(opts.tags) ? opts.tags.filter(Boolean) : [],
      source: 'kv+legacy-dualwrite',
      createdAt: legacyResult?.createdAt ?? now,
      updatedAt: now,
      legacyFilePath: legacyResult?.filePath ?? null,
    })
    // Prepended index line (newest wins seq=1)
    const existingLines = await tx.scan(TABLE_INDEX)
    const all = existingLines
      .map((k, v) => [Number(k), v])
      .sort((a, b) => a[0] - b[0])
    // shift right by 1, keep under MAX_ENTRYPOINT_LINES
    const next = [[1, { id, seq: 1 }]]
    for (let i = 0; i < all.length; i++) {
      const seq = i + 2
      if (seq > MAX_ENTRYPOINT_LINES) break
      const [, val] = all[i]
      next.push([seq, { id: val.id, seq }])
    }
    await tx.clear(TABLE_INDEX)
    for (const [seq, v] of next) await tx.put(TABLE_INDEX, String(seq), v)

    const total = (await tx.scanKeys(TABLE)).length
    await tx.put(TABLE_STATS, 'summary', {
      entriesTotal: total,
      lastAddAt: now,
      lastAddedId: id,
    })
  })

  return {
    id, type, name, description,
    createdAt: legacyResult?.createdAt ?? now,
    filePath: legacyResult?.filePath ?? null,
  }
}

export async function removeEntryKV(cwd, id, opts = {}) {
  await storage.openAll()
  const key = String(id)
  // Delete legacy first — errors surface before KV is touched
  let legacyErr = null
  try { legacyRemove(cwd, key, opts) } catch (e) { legacyErr = e }

  await storage.txn(MemoryDomain, [TABLE, TABLE_INDEX, TABLE_STATS], async (tx) => {
    await tx.del(TABLE, key)
    // rebuild index lines
    const entries = await tx.scan(TABLE)
    const sorted = entries
      .map(([, v]) => v)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, MAX_ENTRYPOINT_LINES)
    await tx.clear(TABLE_INDEX)
    for (let i = 0; i < sorted.length; i++) {
      await tx.put(TABLE_INDEX, String(i + 1), { id: sorted[i].id, seq: i + 1 })
    }
    const total = (await tx.scanKeys(TABLE)).length
    await tx.put(TABLE_STATS, 'summary', {
      entriesTotal: total,
      lastRemoveAt: Date.now(),
      lastRemovedId: key,
    })
  })
  if (legacyErr && legacyErr.ok === false) return legacyErr
  return { ok: true }
}

// ── Build prompt block (like legacy loadMemoryForPrompt) ─────
const MAX_LINKED_FILES = 6
const MAX_LINKED_FILE_CHARS = 9000

function truncateText(s, maxChars) {
  if (s.length <= maxChars) return s
  return s.slice(0, maxChars) + '\n\n[...truncated]\n'
}

function buildMemoryGuidance(memoryDir) {
  return [
    '## Memory',
    `Memory directory: ${memoryDir}`,
    '',
    'Write each memory to its own file using this frontmatter format:',
    '',
    ...MEMORY_FRONTMATTER_EXAMPLE,
    '- Keep each memory file focused on one topic',
    '- Update existing memories instead of duplicating',
    `- Keep ${ENTRYPOINT_NAME} as an index (one line per entry); put details in files`,
  ].join('\n')
}

export async function loadMemoryForPromptKV(cwd, opts = {}) {
  // Fallback: if KV backend is not usable (e.g. no storage dir perms) or
  // explicitly disabled, return legacy result.
  if (opts?.forceLegacy) {
    return legacyLoad(cwd, opts) ?? null
  }

  await storage.openAll()
  const baseDir = opts?.baseDir
  const memoryDir = getProjectMemoryDir(cwd, { baseDir })
  ensureMemoryIndexExists(cwd, { baseDir })

  // Ensure migration has happened once (lazy)
  const g = await storage.getGlobal(MemoryDomain)
  if (!g || !g.legacyMarkdownMigratedAt) {
    try { await migrateLegacyMarkdownToKV(cwd, { baseDir }) } catch { /* swallow, go on */ }
  }

  const sources = []
  const blocks = []
  blocks.push(buildMemoryGuidance(memoryDir))

  // Build index text from indexLines table
  const entries = await listEntriesKV(cwd, { baseDir })
  const indexLines = entries
    .slice(0, MAX_ENTRYPOINT_LINES)
    .map((e) => {
      const name = (e.name || '').replace(/\n/g, ' ').trim() || '(untitled)'
      const desc = (e.description || '').replace(/\n/g, ' ').trim()
      return `- [${name}](${e.id})${desc ? ` — ${desc}` : ''}`
    })
  const rawIndex = `# Memory index\n\n${indexLines.join('\n')}\n`
  const trunc = truncateEntrypointContent(rawIndex)
  const linked = extractIdsFromIndex(trunc.content).slice(0, MAX_LINKED_FILES)

  blocks.push(`[Memory index]\n${trunc.content}\n[/Memory index]`)
  sources.push('kv://memory/indexLines')

  for (const id of linked) {
    const row = await storage.get(MemoryDomain, TABLE, id)
    if (!row) continue
    const body = row.content || ''
    sources.push(`kv://memory/entries/${id}`)
    blocks.push(
      `[Memory file: ${id}]\n${truncateText(body, MAX_LINKED_FILE_CHARS)}\n[/Memory file: ${id}]`
    )
  }
  return {
    text: blocks.join('\n\n').trim(),
    sources,
    memoryDir,
  }
}

function extractIdsFromIndex(markdown) {
  const out = []
  const seen = new Set()
  const re = /\[[^\]]+\]\(([^)]+)\)/g
  let m
  while ((m = re.exec(markdown)) !== null) {
    const link = (m[1] ?? '').trim()
    if (!link) continue
    if (link.startsWith('http://') || link.startsWith('https://') || link.startsWith('file://')) continue
    const cleaned = link.replace(/^\.?\//, '')
    if (seen.has(cleaned)) continue
    seen.add(cleaned)
    out.push(cleaned)
  }
  return out
}

// ── Stats helpers ─────────────────────────────────────────────
export async function getMemoryStatsKV() {
  await storage.openAll()
  const s = await storage.get(MemoryDomain, TABLE_STATS, 'summary')
  const g = await storage.getGlobal(MemoryDomain)
  return {
    entriesTotal: s?.entriesTotal ?? 0,
    lastAddAt: s?.lastAddAt ?? null,
    lastAddedId: s?.lastAddedId ?? null,
    legacyMigratedAt: g?.legacyMarkdownMigratedAt ?? null,
    legacyMigratedCount: g?.legacyMarkdownMigratedCount ?? 0,
    backend: storage.backendFor(MemoryDomain)?.constructor?.name ?? 'unknown',
  }
}

export { ENTRYPOINT_NAME, MAX_ENTRYPOINT_LINES, MAX_ENTRYPOINT_BYTES, MEMORY_TYPES }
