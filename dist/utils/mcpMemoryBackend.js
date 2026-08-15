// ============================================================
//  Guang Code — MCP Memory Backend Adapter
// ============================================================
//
// Unifies 3 MCP memory servers into a single backend interface:
//   - Memorix              @AVIDS2/memorix                 (heuristic local mode)
//   - MCP Reference Memory @modelcontextprotocol/server-memory (substring KG)
//   - Engram               Gentleman-Programming/engram     (project-aware)
//
// ...plus any compatible server that exposes the standard MCP memory
// tools (memorix_* / memory_* / engram_* / generic add_memory/search_memory).
//
// The Adapter discovers tools lazily from the MCP client and routes
// calls to the correct tool names. If the MCP server has never been
// launched, backend.list()/add()/remove() return sensible empty/null
// results and loadMemoryForPrompt returns null so the legacy KV backend
// can take over — zero-config rollback.

import { mcpManager } from './mcpClient.js'

const SERVER_NAME_MEMORY_HINT = /^(memorix|memory|engram|.*-?memory.*)$/i

/**
 * Scan all currently connected MCP clients and return the list of
 * servers that look like they expose memory tools.
 */
export function discoverMemoryServers() {
  const out = []
  const clients = mcpManager.getClients()
  for (const [name] of clients.entries()) {
    if (SERVER_NAME_MEMORY_HINT.test(name)) out.push(name)
  }
  return out
}

/** Tool routing table: canonical action -> list of candidate tool names, tried in order. */
const CANONICAL_ACTIONS = {
  add: ['add_memory', 'memorix_add_memory', 'memory_add', 'engram_add', 'store_memory', 'remember'],
  search: ['search_memory', 'memorix_search', 'memory_search', 'engram_search', 'find_memory', 'recall', 'query_memory'],
  list: ['list_memories', 'memory_list', 'memorix_list', 'engram_list', 'get_memories', 'list_entries'],
  remove: ['remove_memory', 'memory_remove', 'memorix_remove', 'engram_delete', 'delete_memory', 'forget'],
  read: ['read_memory', 'memory_read', 'memorix_get', 'engram_read', 'get_memory'],
}

async function tryTools(client, candidates, input) {
  let lastErr = null
  for (const tool of candidates) {
    try {
      const res = await client.callTool({ name: tool, arguments: input ?? {} })
      if (res && typeof res === 'object' && !res.error) return { tool, result: res }
    } catch (err) {
      lastErr = err
    }
  }
  if (lastErr) throw lastErr
  return null
}

export async function serverCapabilities(serverName) {
  const client = mcpManager.getClients().get(serverName)
  if (!client) return null
  try {
    const listed = await client.listTools()
    const names = listed.tools.map((t) => t.name)
    const cap = {}
    for (const action of Object.keys(CANONICAL_ACTIONS)) {
      cap[action] = CANONICAL_ACTIONS[action].find((n) => names.includes(n)) ?? null
    }
    cap.connected = true
    cap.serverName
    cap.toolNames = names
    return cap
  } catch (_e) {
    return { connected: false }
  }
}

/**
 * The MCP-backed memory backend. Implements the same surface as
 * memoryDomain.js (addEntryKV/listEntriesKV/getEntryKV/...) but routes
 * to the chosen MCP server.
 */
export class McpMemoryBackend {
  constructor(opts = {}) {
    this.preferredServer = opts.preferredServer ?? null   // explicit serverName
    this.disabled = opts.disabled === true
  }

  get id() { return 'mcp' }
  get displayName() { return 'MCP Memory (' + (this.preferredServer ?? 'auto') + ')' }

  async #pickServer() {
    if (this.disabled) return null
    const connected = discoverMemoryServers()
    if (connected.length === 0) return null
    if (this.preferredServer) {
      if (connected.includes(this.preferredServer)) return this.preferredServer
      // Preferred not connected — fall back to any connected one.
    }
    return connected[0]
  }

  async #withClient(cb) {
    const server = await this.#pickServer()
    if (!server) return { ok: false, reason: 'no-mcp-memory-server' }
    const client = mcpManager.getClients().get(server)
    if (!client) return { ok: false, reason: 'mcp-client-missing' }
    try { return await cb(client) } catch (err) { return { ok: false, reason: 'error', error: err } }
  }

  // ── CRUD ───────────────────────────────────────────────────
  async addEntry({ type = 'project', name, description, body, tags = [] }) {
    const content = String(body ?? '').trim()
    if (!content) throw new Error('MCP addEntry: empty body')
    const title = String(name ?? '').trim() || content.split('\n').find(Boolean) || 'memory'
    return await this.#withClient(async (client) => {
      // Pick the first add tool that works; args are server-specific.
      const candidates = CANONICAL_ACTIONS.add
      let lastRes = null
      for (const tool of candidates) {
        // Try shapes most servers accept.
        const shapes = [
          { title, content, type, description: description ?? '', tags },
          { name: title, content, memory_type: type, description: description ?? '', tags },
          { key: title, value: content, type, note: description ?? '' },
          { memory: { title, content, type, description, tags } },
        ]
        for (const input of shapes) {
          try {
            const r = await client.callTool({ name: tool, arguments: input })
            if (r) { lastRes = r; break }
          } catch (_) { /* try next */ }
        }
        if (lastRes) break
      }
      if (!lastRes) return { ok: false, reason: 'no-matching-tool' }
      const id = String(lastRes.id ?? lastRes.entryId ?? lastRes.entry_id ?? (lastRes.entry && (lastRes.entry.id ?? lastRes.entry.entryId)) ?? `${title}-${Date.now()}`)
      return {
        ok: true,
        entry: {
          id,
          type, name: title, description: description ?? '',
          content, tags,
          createdAt: Date.now(), updatedAt: Date.now(),
          source: 'mcp',
        },
      }
    })
  }

  async searchEntries({ query, type, limit = 10 }) {
    return await this.#withClient(async (client) => {
      const shapes = [
        { query: String(query ?? ''), type, limit },
        { q: String(query ?? ''), memory_type: type, max: limit },
        { keyword: String(query ?? ''), type, limit },
        { search: String(query ?? ''), limit },
      ]
      const res = await tryTools(client, CANONICAL_ACTIONS.search, shapes[0])
      let rows = []
      let found = null
      if (res && res.result) {
        found = res
      } else {
        // try other shapes
        for (const tool of CANONICAL_ACTIONS.search) {
          for (let i = 1; i < shapes.length; i++) {
            try {
              const r = await client.callTool({ name: tool, arguments: shapes[i] })
              if (r) { found = { tool, result: r }; break }
            } catch { /* noop */ }
          }
          if (found) break
        }
      }
      const raw = found?.result ?? null
      if (raw) {
        const arr =
          Array.isArray(raw) ? raw
          : Array.isArray(raw.results) ? raw.results
          : Array.isArray(raw.entries) ? raw.entries
          : Array.isArray(raw.matches) ? raw.matches
          : Array.isArray(raw.data) ? raw.data : []
        for (const e of arr) {
          rows.push({
            id: String(e.id ?? e.entryId ?? e.entry_id ?? ''),
            type: String(e.type ?? e.memory_type ?? 'project').toLowerCase(),
            name: String(e.name ?? e.title ?? ''),
            description: String(e.description ?? e.note ?? ''),
            content: String(e.content ?? e.body ?? e.value ?? ''),
            tags: Array.isArray(e.tags) ? e.tags : [],
            createdAt: Number(e.createdAt ?? e.created_at ?? 0),
            updatedAt: Number(e.updatedAt ?? e.updated_at ?? 0),
            source: 'mcp',
          })
        }
      }
      if (type) {
        const t = String(type).toLowerCase()
        rows = rows.filter((r) => r.type === t)
      }
      return { ok: true, entries: rows.slice(0, limit) }
    })
  }

  async listEntries({ type, limit = 100 } = {}) {
    return await this.#withClient(async (client) => {
      const res = await tryTools(client, CANONICAL_ACTIONS.list, { type, limit })
      let rows = []
      const raw = res?.result ?? null
      const arr =
        Array.isArray(raw) ? raw
        : Array.isArray(raw?.results) ? raw.results
        : Array.isArray(raw?.entries) ? raw.entries
        : Array.isArray(raw?.items) ? raw.items : []
      for (const e of arr) {
        rows.push({
          id: String(e.id ?? e.entryId ?? e.entry_id ?? ''),
          type: String(e.type ?? e.memory_type ?? 'project').toLowerCase(),
          name: String(e.name ?? e.title ?? ''),
          description: String(e.description ?? e.note ?? ''),
          content: String(e.content ?? e.body ?? e.value ?? ''),
          tags: Array.isArray(e.tags) ? e.tags : [],
          createdAt: Number(e.createdAt ?? e.created_at ?? 0),
          updatedAt: Number(e.updatedAt ?? e.updated_at ?? 0),
          source: 'mcp',
        })
      }
      if (type) {
        const t = String(type).toLowerCase()
        rows = rows.filter((r) => r.type === t)
      }
      return { ok: true, entries: rows.slice(0, limit) }
    })
  }

  async getEntry(id) {
    return await this.#withClient(async (client) => {
      const res = await tryTools(client, CANONICAL_ACTIONS.read, { id })
      const raw = res?.result ?? null
      if (!raw) return { ok: false, reason: 'not-found' }
      const e = Array.isArray(raw) ? raw[0] : (raw.entry ?? raw.memory ?? raw)
      return {
        ok: true,
        entry: {
          id: String(e.id ?? e.entryId ?? e.entry_id ?? id),
          type: String(e.type ?? e.memory_type ?? 'project').toLowerCase(),
          name: String(e.name ?? e.title ?? ''),
          description: String(e.description ?? e.note ?? ''),
          content: String(e.content ?? e.body ?? e.value ?? ''),
          tags: Array.isArray(e.tags) ? e.tags : [],
          createdAt: Number(e.createdAt ?? e.created_at ?? 0),
          updatedAt: Number(e.updatedAt ?? e.updated_at ?? 0),
          source: 'mcp',
        },
      }
    })
  }

  async removeEntry(id) {
    return await this.#withClient(async (client) => {
      const res = await tryTools(client, CANONICAL_ACTIONS.remove, { id })
      if (res) return { ok: true }
      return { ok: false, reason: 'tool-failed' }
    })
  }

  // ── Prompt loading (mimics KV & legacy) ───────────────────
  async loadMemoryForPrompt(cwd, opts = {}) {
    const limit = opts?.maxEntries ?? 6
    const query = opts?.query ?? null
    const entries = query
      ? (await this.searchEntries({ query, limit })).entries ?? []
      : (await this.listEntries({ limit })).entries ?? []
    if (!Array.isArray(entries) || entries.length === 0) return null

    const maxBody = opts?.maxBodyChars ?? 9000
    const trunc = (s) => (s.length <= maxBody ? s : s.slice(0, maxBody) + '\n\n[...truncated]\n')

    const blocks = [
      '## Memory (MCP backend: ' + (this.preferredServer ?? 'auto') + ')',
      'When the user asks you to remember something, call a memory write tool. ' +
      'When historical information may be relevant, search memory and use relevant results.',
      '',
      '[Memory index]',
      ...entries.map((e, i) => {
        const n = (e.name || '').slice(0, 120) || `memory-${i}`
        const d = (e.description || '').slice(0, 240)
        const type = e.type ?? 'project'
        return `- [${n}](${e.id}) [${type}]${d ? ' — ' + d : ''}`
      }),
      '[/Memory index]',
      '',
      ...entries.map((e) => {
        return `[Memory file: ${e.id}]\n${trunc(e.content || '')}\n[/Memory file: ${e.id}]`
      }),
    ]
    return {
      text: blocks.join('\n'),
      sources: entries.map((e) => `mcp://${this.preferredServer ?? 'auto'}/entries/${e.id}`),
      backend: this.id,
      server: this.preferredServer ?? null,
    }
  }
}
