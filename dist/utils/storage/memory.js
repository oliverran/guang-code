// ============================================================
//  Guang Code — In-Memory Storage Backend (final fallback)
//  Used when *all* on-disk backends fail (EPERM, sandbox, etc.)
//  Data is lost on process restart — we warn the user about this.
// ============================================================

import { StorageBackend } from './types.js'

export class InMemoryStorageBackend extends StorageBackend {
  #domains = new Map() // name -> { global, tables: { tname: { rows: {key: {v, __exp}} } } }
  #opened = false
  #warned = false

  constructor() { super() }

  get baseDir() { return ':memory:' }

  async open() {
    if (this.#opened) return
    if (!this.#warned) {
      // eslint-disable-next-line no-console
      console.warn(
        '\n  ⚠️  [storage] Falling back to IN-MEMORY storage.\n' +
        '      This is usually because your home directory (~/.guang-code) is not writable\n' +
        '      (EPERM, antivirus lock, sandbox, etc.). Data will be LOST when this process exits.\n' +
        '      Fix: chown/chmod ~/.guang-code, or set env GC_STORAGE_JSON_DIR to a writable path.\n'
      )
      this.#warned = true
    }
    this.#opened = true
  }

  async close() {
    this.#domains.clear()
    this.#opened = false
  }

  #ensure(domain) {
    if (!this.#domains.has(domain.name)) {
      const tables = {}
      for (const tname of Object.keys(domain.tables)) {
        tables[tname] = { rows: {} }
      }
      this.#domains.set(domain.name, {
        global: { ...(domain.globalInitial ?? {}) },
        tables,
      })
    }
    return this.#domains.get(domain.name)
  }

  async txn(domain, tables, callback) {
    if (!this.#opened) await this.open()
    const state = this.#ensure(domain)
    // Deep snapshot for rollback
    const snapshot = JSON.stringify(state)
    const applyDefaults = (tname, value) => {
      const tbl = domain.tables[tname]
      if (!tbl || !tbl.valueDefaults) return value
      if (Array.isArray(value) || typeof value !== 'object') return value
      return { ...tbl.valueDefaults, ...value }
    }
    let committed = false
    const tx = {
      get: async (tname, key) => {
        const bucket = state.tables[tname]?.rows
        if (!bucket) return null
        const row = bucket[String(key)]
        if (!row) return null
        if (typeof row.__exp === 'number' && row.__exp > 0 && row.__exp < Date.now()) {
          delete bucket[String(key)]
          return null
        }
        return row.v ?? null
      },
      put: async (tname, key, value) => {
        if (!state.tables[tname]) state.tables[tname] = { rows: {} }
        const bucket = state.tables[tname].rows
        const tbl = domain.tables[tname]
        const ttlMs = tbl?.ttlMs
        const row = { v: applyDefaults(tname, value) }
        if (ttlMs && Number.isFinite(ttlMs) && ttlMs > 0) {
          row.__exp = Date.now() + ttlMs
        }
        bucket[String(key)] = row
      },
      del: async (tname, key) => {
        const bucket = state.tables[tname]?.rows
        if (!bucket) return
        if (bucket[String(key)] !== undefined) delete bucket[String(key)]
      },
      clear: async (tname) => {
        if (state.tables[tname]) state.tables[tname].rows = {}
      },
      scan: async (tname, opts = {}) => {
        const bucket = state.tables[tname]?.rows ?? {}
        const now = Date.now()
        let entries = []
        for (const [k, row] of Object.entries(bucket)) {
          if (typeof row.__exp === 'number' && row.__exp > 0 && row.__exp < now) {
            delete bucket[k]
            continue
          }
          entries.push([k, row.v])
        }
        if (opts && typeof opts.filter === 'function') entries = entries.filter(([k, v]) => opts.filter(k, v))
        if (opts && typeof opts.map === 'function') entries = entries.map(([k, v]) => [k, opts.map(k, v)])
        if (opts && typeof opts.limit === 'number' && opts.limit >= 0) entries = entries.slice(0, opts.limit)
        return entries
      },
      scanKeys: async (tname) => {
        const bucket = state.tables[tname]?.rows ?? {}
        const out = []
        const now = Date.now()
        for (const [k, row] of Object.entries(bucket)) {
          if (typeof row.__exp === 'number' && row.__exp > 0 && row.__exp < now) {
            delete bucket[k]
            continue
          }
          out.push(k)
        }
        return out
      },
      getGlobal: async () => ({ ...state.global }),
      setGlobal: async (next) => { state.global = { ...next } },
    }
    let result
    try {
      result = await callback(tx)
      committed = true
    } finally {
      if (!committed) {
        try {
          const restored = JSON.parse(snapshot)
          state.global = restored.global
          state.tables = restored.tables
        } catch {}
      }
    }
    return result
  }

  async get(domain, table, key) {
    if (!this.#opened) await this.open()
    const state = this.#ensure(domain)
    let found = null
    await this.txn(domain, [table], async (tx) => { found = await tx.get(table, key) })
    return found
  }
  async put(domain, table, key, value) {
    await this.txn(domain, [table], async (tx) => { await tx.put(table, key, value) })
    return true
  }
  async del(domain, table, key) {
    await this.txn(domain, [table], async (tx) => { await tx.del(table, key) })
    return true
  }
  async scan(domain, table, opts) {
    let result = []
    await this.txn(domain, [table], async (tx) => { result = await tx.scan(table, opts) })
    return result
  }
  async keys(domain, table) {
    let result = []
    await this.txn(domain, [table], async (tx) => { result = await tx.scanKeys(table) })
    return result
  }
  async getGlobal(domain) {
    if (!this.#opened) await this.open()
    const state = this.#ensure(domain)
    return { ...state.global, ...(domain.globalInitial ?? {}) }
  }
  async updateGlobal(domain, fn) {
    await this.txn(domain, [], async (tx) => {
      const cur = await tx.getGlobal()
      const next = await Promise.resolve(fn(cur))
      await tx.setGlobal(next ?? cur)
    })
    return true
  }
}
