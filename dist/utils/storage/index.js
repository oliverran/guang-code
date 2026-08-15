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

import { defineDomain, domainTable } from './types.js'
import { JsonStorageBackend } from './json.js'
import { SqliteStorageBackend } from './sqlite.js'

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
  #defaultKind = 'json'
  #overrides = new Map() // domain.name -> 'json' | 'sqlite'

  constructor() {
    this.#jsonBackend = new JsonStorageBackend()
    this.#sqliteBackend = new SqliteStorageBackend()
  }

  get json() { return this.#jsonBackend }
  get sqlite() { return this.#sqliteBackend }

  setDefaultBackend(kind) {
    if (kind !== 'json' && kind !== 'sqlite') {
      throw new Error(`Unknown backend kind: ${kind} (expected json|sqlite)`)
    }
    this.#defaultKind = kind
  }

  /** Force a specific domain to use a backend regardless of default. */
  setDomainBackend(domainName, kind) {
    if (kind !== 'json' && kind !== 'sqlite') {
      throw new Error(`Unknown backend kind: ${kind}`)
    }
    this.#overrides.set(domainName, kind)
  }

  backendFor(domain) {
    const preferred = this.#overrides.get(domain.name) ?? this.#defaultKind
    if (preferred === 'sqlite' && this.#sqliteBackend.isAvailable) {
      return this.#sqliteBackend
    }
    // Fallback: json is always available
    return this.#jsonBackend
  }

  async openAll() {
    await this.#jsonBackend.open()
    if (this.#sqliteBackend.isAvailable) await this.#sqliteBackend.open()
  }

  async closeAll() {
    try { await this.#jsonBackend.close() } catch {}
    try { await this.#sqliteBackend.close() } catch {}
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

/** Shortcut: try SQLite; fall back to JSON if better-sqlite3 isn't installed. */
export function useSqliteBackendIfAvailable() {
  if (storage.sqlite.isAvailable) storage.setDefaultBackend('sqlite')
  else storage.setDefaultBackend('json')
}
