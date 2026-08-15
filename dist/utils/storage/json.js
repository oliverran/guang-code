// ============================================================
//  Guang Code — JSON Storage Backend (atomic file-based)
// ============================================================

import fs from 'node:fs'
import path from 'node:path'
import { StorageBackend } from './types.js'
import { homedir } from 'node:os'

/**
 * JSON backend — single JSON file per domain, atomic writes.
 * Good for low-write domains (memory entries, user settings),
 * which is the target for Memory domain initially.
 */
export class JsonStorageBackend extends StorageBackend {
  #baseDir
  #files = new Map() // domain.name -> { path, data, dirty, lastMtime }
  #opened = false

  constructor(opts = {}) {
    super()
    const envOverride = process.env.GC_STORAGE_JSON_DIR
    this.#baseDir = path.resolve(
      opts.baseDir ?? (envOverride && envOverride.trim() ? envOverride.trim() : path.join(homedir(), '.guang-code', 'storage', 'json'))
    )
  }

  get baseDir() { return this.#baseDir }

  async open() {
    if (this.#opened) return
    fs.mkdirSync(this.#baseDir, { recursive: true })
    this.#opened = true
  }

  async close() {
    await this.#flushAll()
    this.#files.clear()
    this.#opened = false
  }

  // ─── core: load / flush ────────────────────────────────────────
  #domainPath(domainName) {
    const safe = domainName.replace(/[^a-zA-Z0-9._-]/g, '_')
    return path.join(this.#baseDir, `${safe}.v1.json`)
  }

  #loadFile(domain) {
    const name = domain.name
    if (this.#files.has(name)) return this.#files.get(name)
    const fp = this.#domainPath(name)
    let data = null
    try {
      if (fs.existsSync(fp)) {
        const raw = fs.readFileSync(fp, 'utf-8').trim()
        if (raw) data = JSON.parse(raw)
      }
    } catch (e) {
      // corruption — back up and start fresh
      try {
        fs.copyFileSync(fp, `${fp}.corrupted.${Date.now()}`)
      } catch {}
      data = null
    }
    if (!data || typeof data !== 'object') {
      data = {
        _version: domain.version,
        _storageVer: 1,
        _createdAt: Date.now(),
        _updatedAt: Date.now(),
        global: domain.globalInitial ?? {},
        tables: {},
      }
      for (const tname of Object.keys(domain.tables)) {
        data.tables[tname] = { _version: domain.tables[tname].version ?? 1, rows: {} }
      }
    } else {
      // ensure table buckets exist (new tables added post-hoc)
      data._version = data._version ?? domain.version
      data.global = data.global ?? domain.globalInitial ?? {}
      data.tables = data.tables ?? {}
      for (const tname of Object.keys(domain.tables)) {
        if (!data.tables[tname]) {
          data.tables[tname] = {
            _version: domain.tables[tname].version ?? 1,
            rows: {},
          }
        }
      }
    }
    const state = { path: fp, data, dirty: false, lastMtime: Date.now() }
    this.#files.set(name, state)
    return state
  }

  async #flushAll() {
    for (const [name, state] of this.#files.entries()) {
      if (state.dirty) {
        await this.#flushOne(state)
      }
    }
  }

  #flushOne(state) {
    const dir = path.dirname(state.path)
    fs.mkdirSync(dir, { recursive: true })
    state.data._updatedAt = Date.now()
    const tmp = `${state.path}.${process.pid}.${Date.now()}.tmp`
    const str = JSON.stringify(state.data, null, 2)
    fs.writeFileSync(tmp, str, 'utf-8')
    try {
      fs.renameSync(tmp, state.path)
    } catch (e) {
      const err = e
      if (err.code === 'EEXIST' || err.code === 'EPERM') {
        try { fs.unlinkSync(state.path) } catch {}
        fs.renameSync(tmp, state.path)
      } else {
        try { fs.unlinkSync(tmp) } catch {}
        throw e
      }
    }
    state.dirty = false
    state.lastMtime = Date.now()
  }

  // ─── transactions ──────────────────────────────────────────────
  async txn(domain, tables, callback) {
    if (!this.#opened) await this.open()
    const state = this.#loadFile(domain)
    let committed = false

    // snapshot before — used on error to rollback
    const snapshot = JSON.stringify(state.data)

    const applyDefaults = (tname, value) => {
      const tbl = domain.tables[tname]
      if (!tbl || !tbl.valueDefaults) return value
      if (Array.isArray(value) || typeof value !== 'object') return value
      return { ...tbl.valueDefaults, ...value }
    }

    const tx = {
      get: async (tname, key) => {
        const bucket = state.data.tables[tname]?.rows
        if (!bucket) return null
        const row = bucket[String(key)]
        if (!row) return null
        // ttl eviction if expired
        if (typeof row.__exp === 'number' && row.__exp > 0 && row.__exp < Date.now()) {
          delete bucket[String(key)]
          state.dirty = true
          return null
        }
        return row.v ?? null
      },
      put: async (tname, key, value) => {
        let bucket = state.data.tables[tname]
        if (!bucket) {
          state.data.tables[tname] = { _version: 1, rows: {} }
          bucket = state.data.tables[tname]
        }
        const tbl = domain.tables[tname]
        const ttlMs = tbl?.ttlMs
        const row = { v: applyDefaults(tname, value) }
        if (ttlMs && Number.isFinite(ttlMs) && ttlMs > 0) {
          row.__exp = Date.now() + ttlMs
        }
        bucket.rows[String(key)] = row
        state.dirty = true
      },
      del: async (tname, key) => {
        const bucket = state.data.tables[tname]?.rows
        if (!bucket) return
        if (bucket[String(key)] !== undefined) {
          delete bucket[String(key)]
          state.dirty = true
        }
      },
      clear: async (tname) => {
        if (!state.data.tables[tname]) return
        state.data.tables[tname].rows = {}
        state.dirty = true
      },
      scan: async (tname, opts = {}) => {
        const bucket = state.data.tables[tname]?.rows ?? {}
        const now = Date.now()
        let entries = []
        for (const [k, row] of Object.entries(bucket)) {
          if (typeof row.__exp === 'number' && row.__exp > 0 && row.__exp < now) {
            delete bucket[k]
            state.dirty = true
            continue
          }
          entries.push([k, row.v])
        }
        if (opts && typeof opts.filter === 'function') {
          entries = entries.filter(([k, v]) => opts.filter(k, v))
        }
        if (opts && typeof opts.map === 'function') {
          entries = entries.map(([k, v]) => [k, opts.map(k, v)])
        }
        if (opts && typeof opts.limit === 'number' && opts.limit >= 0) {
          entries = entries.slice(0, opts.limit)
        }
        return entries
      },
      scanKeys: async (tname) => {
        const bucket = state.data.tables[tname]?.rows ?? {}
        const out = []
        const now = Date.now()
        for (const [k, row] of Object.entries(bucket)) {
          if (typeof row.__exp === 'number' && row.__exp > 0 && row.__exp < now) {
            delete bucket[k]
            state.dirty = true
            continue
          }
          out.push(k)
        }
        return out
      },
      getGlobal: async () => {
        return state.data.global ?? domain.globalInitial ?? {}
      },
      setGlobal: async (next) => {
        state.data.global = next
        state.dirty = true
      },
    }

    try {
      await callback(tx)
      // successful — flush once
      if (state.dirty) this.#flushOne(state)
      committed = true
    } finally {
      if (!committed) {
        // rollback to snapshot
        try {
          state.data = JSON.parse(snapshot)
        } catch {}
      }
    }
  }

  async getGlobal(domain) {
    if (!this.#opened) await this.open()
    const state = this.#loadFile(domain)
    return state.data.global ?? domain.globalInitial ?? {}
  }
}
