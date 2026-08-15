// ============================================================
//  Guang Code — Domain Storage Hub
// ============================================================
//
// Public entry point for all domain KV work:
//   import { storage, MemoryDomain, useJsonBackend, useSqliteBackend }
//     from './storage/index.js'
//
// Implements backend switching + routing: default backend for a domain
// is JSON, memory.stats can be pinned to SQLite when available.
//
// FAILURE MODE: if *all* disk backends fail (EPERM, sandbox, antivirus),
// the Hub transparently falls back to an in-memory backend. The user
// is warned once. Data won't persist across restarts but the app won't crash.

import { defineDomain, domainTable } from './types.js'
import { JsonStorageBackend } from './json.js'
import { SqliteStorageBackend } from './sqlite.js'
import { InMemoryStorageBackend } from './memory.js'

// ── Memory Domain (declaration, usable by both backends) ───────
export const MEMORY_TYPES = Object.freeze(['user', 'feedback', 'project', 'reference'])

/** One entry in the memory table = one topic file's structured representation. */
export const MemoryEntriesTable = domainTable({
  version: 2,
  // key = memory id (e.g. "my-topic-abc12345.md" or uuid from MCP server)
  // value:
})

export const MemoryIndexLinesTable = domainTable({
  version: 1,
  // key = index line number (as insertion order for stable ranking)
  ttlMs: 0,
})

export const MemoryStatsTable = domainTable({
  version: 2,
  ttlMs: 0,
})

export const MemoryDomain = defineDomain({
  name: 'memory',
  version: 2,
  tables: {
    entries: MemoryEntriesTable,
    indexLines: MemoryIndexLinesTable,
    stats: MemoryStatsTable,
  },
  global: {
    initial: { nextSequentialId: 1, schemaVersion: 2, legacyMarkdownMigratedAt: 0 },
  },
  onUpgrade(tx, fromVer, toVer) {
    // Hook for future migrations. Currently no-op.
  },
})

// ── Storage Hub singleton ─────────────────────────────────────
class StorageHub {
  #jsonBackend = null
  #sqliteBackend = null
  #memoryBackend = null
  #defaultKind = 'json'
  #overrides = new Map() // domain.name -> 'json' | 'sqlite' | 'memory'
  #jsonOpenFailed = false

  constructor() {
    this.#jsonBackend = new JsonStorageBackend()
    this.#sqliteBackend = new SqliteStorageBackend()
    this.#memoryBackend = new InMemoryStorageBackend()
  }

  get json() { return this.#jsonBackend }
  get sqlite() { return this.#sqliteBackend }
  get memory() { return this.#memoryBackend }

  setDefaultBackend(kind) {
    if (kind !== 'json' && kind !== 'sqlite' && kind !== 'memory') {
      throw new Error(`Unknown backend kind: ${kind} (expected json|sqlite|memory)`)
    }
    this.#defaultKind = kind
  }

  /** Force a specific domain to use a backend regardless of default. */
  setDomainBackend(domainName, kind) {
    if (kind !== 'json' && kind !== 'sqlite' && kind !== 'memory') {
      throw new Error(`Unknown backend kind: ${kind}`)
    }
    this.#overrides.set(domainName, kind)
  }

  backendFor(domain) {
    const preferred = this.#overrides.get(domain.name) ?? this.#defaultKind
    if (preferred === 'memory') return this.#memoryBackend
    if (preferred === 'sqlite' && this.#sqliteBackend.isAvailable) {
      return this.#sqliteBackend
    }
    // JSON is primary disk backend; if *it* also failed → memory
    if (!this.#jsonOpenFailed) {
      return this.#jsonBackend
    }
    return this.#memoryBackend
  }

  async openAll() {
    // Try JSON first
    try {
      await this.#jsonBackend.open()
    } catch (e) {
      const err = e
      this.#jsonOpenFailed = true
      const code = err?.code ?? 'UNKNOWN'
      // eslint-disable-next-line no-console
      console.warn(
        `  ⚠️  [storage-hub] JSON backend failed to open (${code}). ` +
        `This session will use an in-memory backend.\n` +
        `      Fix: chown/chmod ~/.guang-code  or  set GC_STORAGE_JSON_DIR to a writable path.\n`
      )
    }
    // Try SQLite — failure is non-fatal, Hub will just not use it
    if (this.#sqliteBackend.isAvailable) {
      try {
        await this.#sqliteBackend.open()
      } catch { /* ignore — Hub already falls back via isAvailable + #openFailed */ }
    }
    // Memory backend — never fails (always available)
    try { await this.#memoryBackend.open() } catch {}
  }

  async closeAll() {
    try { await this.#jsonBackend.close() } catch {}
    try { await this.#sqliteBackend.close() } catch {}
    try { await this.#memoryBackend.close() } catch {}
  }

  // Convenience: pick the right backend and forward.
  async txn(domain, tables, cb) {
    const b = this.backendFor(domain)
    if (!b || !(typeof b.txn === 'function')) {
      throw new Error(`No storage backend available for domain ${domain.name}`)
    }
    return await b.txn(domain, tables, cb)
  }
  async get(domain, table, key) { return await this.backendFor(domain).get(domain, table, key) }
  async put(domain, table, key, value) { return await this.backendFor(domain).put(domain, table, key, value) }
  async del(domain, table, key) { return await this.backendFor(domain).del(domain, table, key) }
  async scan(domain, table, opts) { return await this.backendFor(domain).scan(domain, table, opts) }
  async keys(domain, table) { return await this.backendFor(domain).keys(domain, table) }
  async getGlobal(domain) { return await this.backendFor(domain).getGlobal(domain) }
  async updateGlobal(domain, fn) { return await this.backendFor(domain).updateGlobal(domain, fn) }
}

export const storage = new StorageHub()

/** Shortcut: force JSON backend globally (for tests / Windows / older Node). */
export function useJsonBackend() { storage.setDefaultBackend('json') }

/** Shortcut: force in-memory backend (for tests, read-only sandboxes, demos). */
export function useMemoryBackend() { storage.setDefaultBackend('memory') }

/** Shortcut: try SQLite; fall back to JSON if better-sqlite3 isn't installed. */
export function useSqliteBackendIfAvailable() {
  if (storage.sqlite.isAvailable) storage.setDefaultBackend('sqlite')
  else storage.setDefaultBackend('json')
}

