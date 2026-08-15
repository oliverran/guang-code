// ============================================================
//  Guang Code — SQLite Storage Backend (better-sqlite3 optional)
// ============================================================
//
// If better-sqlite3 is not installed, the backend is still importable;
// open() will NOT throw — it simply marks itself unavailable so the
// Hub can fall back to JSON (or InMemory) automatically.
//
// Directory creation uses the same 3-tier fallback as the JSON backend
// (home → project → tmpdir) to survive EPERM on Windows.

import fs from 'node:fs'
import path from 'node:path'
import { StorageBackend } from './types.js'
import { homedir, tmpdir } from 'node:os'

function lazyLoadBetterSqlite() {
  try {
    // eslint-disable-next-line global-require
    return require('better-sqlite3')
  } catch (_e) {
    try {
      // ESM fallback via dynamic import attempt
      return null
    } catch {
      return null
    }
  }
}

export class SqliteStorageBackend extends StorageBackend {
  #candidates
  #baseDir
  #Databases = null
  #handles = new Map() // domain.name -> { db, path, openedAt }
  #opened = false
  #openFailed = false

  constructor(opts = {}) {
    super()
    const envOverride = process.env.GC_STORAGE_SQLITE_DIR
    const preferred = path.resolve(
      opts.baseDir ?? (envOverride && envOverride.trim() ? envOverride.trim() : path.join(homedir(), '.guang-code', 'storage', 'sqlite'))
    )
    this.#candidates = [
      preferred,
      path.resolve(process.cwd(), '.guang-code', 'storage', 'sqlite'),
      path.join(tmpdir(), `guang-code-${process.pid}-${Date.now().toString(36)}`, 'storage', 'sqlite'),
    ]
    this.#baseDir = preferred
  }

  get baseDir() { return this.#baseDir }

  get isAvailable() {
    // Check once per instance; cache nullability
    if (this.#openFailed) return false
    if (this.#Databases !== undefined && this.#Databases !== null) return true
    this.#Databases = lazyLoadBetterSqlite()
    return !!this.#Databases
  }

  async open() {
    if (this.#opened) return
    if (!this.isAvailable) {
      // Don't throw — caller will fall back to JSON/InMemory. Just silently skip.
      this.#openFailed = true
      return
    }
    let lastErr = null
    for (const cand of this.#candidates) {
      try {
        fs.mkdirSync(cand, { recursive: true })
        const probe = path.join(cand, `.probe-${process.pid}-${Date.now().toString(36)}.tmp`)
        fs.writeFileSync(probe, 'ok', 'utf-8')
        fs.unlinkSync(probe)
        this.#baseDir = cand
        if (cand !== this.#candidates[0]) {
          // eslint-disable-next-line no-console
          console.warn(`  ⚠️  [storage-sqlite] Home dir unwritable — using fallback directory:
      ${cand}\n`)
        }
        this.#opened = true
        return
      } catch (e) {
        lastErr = e
      }
    }
    // All candidates failed — mark unavailable so Hub falls back
    this.#openFailed = true
    this.#Databases = null
    if (lastErr && (lastErr.code === 'EPERM' || lastErr.code === 'EACCES')) {
      // eslint-disable-next-line no-console
      console.warn(`  ⚠️  [storage-sqlite] Cannot create storage dir (${lastErr.code}); SQLite backend disabled for this session.\n`)
    }
  }

  async close() {
    for (const h of this.#handles.values()) {
      try { h.db.close() } catch {}
    }
    this.#handles.clear()
    this.#opened = false
  }

  #dbPath(domainName) {
    const safe = domainName.replace(/[^a-zA-Z0-9._-]/g, '_')
    return path.join(this.#baseDir, `${safe}.v1.sqlite`)
  }

  #handle(domain) {
    const name = domain.name
    if (this.#handles.has(name)) return this.#handles.get(name)
    const fp = this.#dbPath(name)
    const DatabaseCtor = this.#Databases
    if (!DatabaseCtor) {
      throw new Error('[storage-sqlite] better-sqlite3 unavailable')
    }
    const db = new DatabaseCtor(fp)
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = NORMAL')

    // Create domain metadata table + one table per declared bucket
    db.exec(`
      CREATE TABLE IF NOT EXISTS __domain_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)
    const upsert = db.prepare(
      `INSERT INTO __domain_meta(key,value) VALUES(?,?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`
    )
    upsert.run('domain', domain.name)
    upsert.run('version', String(domain.version))
    upsert.run('storageVer', '1')

    for (const tname of Object.keys(domain.tables)) {
      const t = this.#safeIdent(tname)
      db.exec(`
        CREATE TABLE IF NOT EXISTS ${t} (
          k TEXT PRIMARY KEY,
          v TEXT NOT NULL,
          exp INTEGER DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS ${t}_exp ON ${t}(exp);
      `)
    }
    // __domain_global (one row)
    db.exec(`
      CREATE TABLE IF NOT EXISTS __domain_global (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        value TEXT NOT NULL
      );
    `)
    const h = { db, path: fp, openedAt: Date.now() }
    this.#handles.set(name, h)
    return h
  }

  #safeIdent(s) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)) {
      throw new Error(`[storage-sqlite] invalid identifier: ${s}`)
    }
    return s
  }

  async txn(domain, tables, callback) {
    if (!this.#opened) await this.open()
    const h = this.#handle(domain)
    const db = h.db
    const applyDefaults = (tname, value) => {
      const tbl = domain.tables[tname]
      if (!tbl || !tbl.valueDefaults) return value
      if (Array.isArray(value) || typeof value !== 'object') return value
      return { ...tbl.valueDefaults, ...value }
    }

    return await db.transaction(() => {
      // Sync get (better-sqlite3 is sync, we still return thenable)
      const makeTx = () => {
        const tx = {
          get: async (tname, key) => {
            const t = this.#safeIdent(tname)
            const row = db.prepare(`SELECT v, exp FROM ${t} WHERE k = ?`).get(String(key))
            if (!row) return null
            if (row.exp && row.exp > 0 && row.exp < Date.now()) {
              db.prepare(`DELETE FROM ${t} WHERE k = ?`).run(String(key))
              return null
            }
            try { return JSON.parse(row.v) } catch { return null }
          },
          put: async (tname, key, value) => {
            const t = this.#safeIdent(tname)
            const tbl = domain.tables[tname]
            const ttlMs = tbl?.ttlMs ?? 0
            const exp = (ttlMs && Number.isFinite(ttlMs) && ttlMs > 0) ? (Date.now() + ttlMs) : 0
            db.prepare(`
              INSERT INTO ${t}(k,v,exp) VALUES(?,?,?)
              ON CONFLICT(k) DO UPDATE SET v=excluded.v, exp=excluded.exp
            `).run(String(key), JSON.stringify(applyDefaults(tname, value)), exp)
          },
          del: async (tname, key) => {
            const t = this.#safeIdent(tname)
            db.prepare(`DELETE FROM ${t} WHERE k = ?`).run(String(key))
          },
          clear: async (tname) => {
            const t = this.#safeIdent(tname)
            db.prepare(`DELETE FROM ${t}`).run()
          },
          scan: async (tname, opts = {}) => {
            const t = this.#safeIdent(tname)
            const now = Date.now()
            const all = db.prepare(`SELECT k,v,exp FROM ${t}`).all()
            let entries = []
            for (const r of all) {
              if (r.exp && r.exp > 0 && r.exp < now) continue
              let v
              try { v = JSON.parse(r.v) } catch { continue }
              entries.push([r.k, v])
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
            const t = this.#safeIdent(tname)
            const now = Date.now()
            const rows = db.prepare(`SELECT k, exp FROM ${t}`).all()
            const out = []
            for (const r of rows) {
              if (r.exp && r.exp > 0 && r.exp < now) continue
              out.push(r.k)
            }
            return out
          },
          getGlobal: async () => {
            const row = db.prepare('SELECT value FROM __domain_global WHERE id = 1').get()
            if (!row) return domain.globalInitial ?? {}
            try { return JSON.parse(row.value) } catch { return domain.globalInitial ?? {} }
          },
          setGlobal: async (next) => {
            db.prepare(`
              INSERT INTO __domain_global(id, value) VALUES(1, ?)
              ON CONFLICT(id) DO UPDATE SET value=excluded.value
            `).run(JSON.stringify(next))
          },
        }
        return tx
      }
      const tx = makeTx()
      // Run synchronously (better-sqlite3 is sync) inside implicit transaction.
      return callback(tx)
    })()
  }

  async getGlobal(domain) {
    if (!this.#opened) await this.open()
    const h = this.#handle(domain)
    const row = h.db.prepare('SELECT value FROM __domain_global WHERE id = 1').get()
    if (!row) return domain.globalInitial ?? {}
    try { return JSON.parse(row.value) } catch { return domain.globalInitial ?? {} }
  }
}
