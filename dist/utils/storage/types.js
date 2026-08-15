// ============================================================
//  Guang Code — Domain KV Storage: Type Definitions
// ============================================================

/**
 * A domain table is a schema declaration for a key-value bucket within a domain.
 * Each table has a key type K, a value type V, and an optional zod schema.
 *
 *   const MemoryEntriesTable = domainTable({
 *     version: 1,
 *     key: z.string(),
 *     value: MemoryEntrySchema,
 *   })
 */
export function domainTable(opts) {
  return {
    kind: 'domain-table',
    version: opts.version ?? 1,
    keySchema: opts.key,
    valueSchema: opts.value,
    valueDefaults: opts.defaults,
    ttlMs: opts.ttlMs,
  }
}

/**
 * Define a storage domain with named tables + an optional global blob.
 *
 *   const MemoryDomain = defineDomain({
 *     name: 'memory',
 *     version: 2,
 *     tables: { entries: MemoryEntriesTable, stats: StatsTable },
 *     global: { initial: { nextId: 0 } },
 *   })
 */
export function defineDomain(spec) {
  return {
    kind: 'domain',
    name: spec.name,
    version: spec.version ?? 1,
    tables: spec.tables ?? {},
    globalSchema: spec.global?.schema,
    globalInitial: spec.global?.initial,
    onUpgrade: spec.onUpgrade, // (tx, fromVer, toVer) => void
  }
}

/** Unified storage backend interface (subset of DSH design). */
export class StorageBackend {
  /** Open / initialize the store. */
  async open() { throw new Error('not implemented') }
  /** Close the store. */
  async close() { throw new Error('not implemented') }
  /** Run a transaction. tx: { get, put, del, clear, scan, scanKeys } */
  async txn(domain, tables, callback) { throw new Error('not implemented') }

  // — non-transactional convenience helpers —
  async get(domain, table, key) {
    let out = null
    await this.txn(domain, [table], async (tx) => { out = await tx.get(table, key) })
    return out
  }
  async put(domain, table, key, value) {
    await this.txn(domain, [table], async (tx) => { await tx.put(table, key, value) })
  }
  async del(domain, table, key) {
    await this.txn(domain, [table], async (tx) => { await tx.del(table, key) })
  }
  async scan(domain, table, opts) {
    let out = []
    await this.txn(domain, [table], async (tx) => { out = await tx.scan(table, opts) })
    return out
  }
  async keys(domain, table) {
    let out = []
    await this.txn(domain, [table], async (tx) => { out = await tx.scanKeys(table) })
    return out
  }
  async getGlobal(domain) {
    return null
  }
  async updateGlobal(domain, fn) {
    await this.txn(domain, [], async (tx) => {
      const cur = (await tx.getGlobal()) ?? (domain.globalInitial ?? {})
      await tx.setGlobal(await fn(cur))
    })
  }
}

export const STORAGE_VERSION = 1
