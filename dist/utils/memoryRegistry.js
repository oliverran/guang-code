// ============================================================
//  Guang Code — Memory Backend Registry (Multi-Backend Switching)
// ============================================================
//
// Unified memory API that routes to one or more backends:
//   • legacy       - original memdir.js (markdown files only, kept for rollback)
//   • kv           - new domain-KV store (json or sqlite, dual-write with legacy)
//   • mcp          - external memory via MCP (any server)
//   • hybrid (default) - kv for writes, mcp for prompt loading if connected,
//                        otherwise kv prompt. Ensures zero disruption.
//
// Configuration lives in ~/.guang-code/config.json under the `memory` key.
// Example:
//   "memory": {
//     "backend": "hybrid",            // "legacy" | "kv" | "mcp" | "hybrid"
//     "kvBackend": "json",            // "json" | "sqlite" (if available)
//     "mcpPreferredServer": "memorix", // optional server name
//     "mcpFallbackToKV": true,        // if mcp not connected, use kv
//     "legacyDualWrite": true,        // keep markdown files up-to-date
//   }

import {
  loadMemoryForPromptKV,
  addEntryKV,
  listEntriesKV,
  getEntryKV,
  removeEntryKV,
  getMemoryStatsKV,
  migrateLegacyMarkdownToKV,
} from './memoryDomain.js'

import {
  loadMemoryForPrompt as legacyLoadPrompt,
  addMemory as legacyAdd,
  listMemoryEntries as legacyList,
  readMemoryFile as legacyRead,
  removeMemory as legacyRemove,
} from './memdir.js'

import { McpMemoryBackend, discoverMemoryServers, serverCapabilities } from './mcpMemoryBackend.js'
import { storage, useSqliteBackendIfAvailable } from './storage/index.js'

// ── Default config shape ─────────────────────────────────────
export const DEFAULT_MEMORY_CONFIG = Object.freeze({
  backend: 'hybrid',
  kvBackend: 'json',
  mcpPreferredServer: null,
  mcpFallbackToKV: true,
  legacyDualWrite: true,
  maxPromptEntries: 6,
  maxPromptBodyChars: 9000,
})

export function validateMemoryConfig(raw) {
  const out = { ...DEFAULT_MEMORY_CONFIG, ...(raw && typeof raw === 'object' ? raw : {}) }
  if (!['legacy', 'kv', 'mcp', 'hybrid'].includes(out.backend)) out.backend = 'hybrid'
  if (!['json', 'sqlite'].includes(out.kvBackend)) out.kvBackend = 'json'
  return out
}

// ── Config helpers: read from / write to GcConfig ─────────────
export function getMemoryConfigFromGcConfig(gcConfig) {
  const raw = (gcConfig && typeof gcConfig === 'object') ? gcConfig.memory : null
  return validateMemoryConfig(raw)
}

/**
 * Apply a memory config to runtime singletons (storage backend selection,
 * MCP backend instantiation). Safe to call multiple times.
 */
export function applyMemoryConfig(gcConfig) {
  const cfg = getMemoryConfigFromGcConfig(gcConfig)
  if (cfg.kvBackend === 'sqlite') {
    useSqliteBackendIfAvailable() // falls back to json if not installed
  } else {
    storage.setDefaultBackend('json')
  }
  return cfg
}

// ── The singleton memory façade used everywhere ─────────────
class MemoryRegistry {
  #mcpBackend = null
  #lastCfg = null

  ensureMcpBackend(cfg) {
    const want = cfg.mcpPreferredServer ?? null
    if (!this.#mcpBackend || this.#mcpBackend.preferredServer !== want) {
      this.#mcpBackend = new McpMemoryBackend({ preferredServer: want })
    }
    return this.#mcpBackend
  }

  async addEntry(cwd, opts, gcConfig) {
    const cfg = applyMemoryConfig(gcConfig ?? {})
    if (cfg.backend === 'legacy') {
      return legacyAdd(cwd, opts)
    }

    // KV path (dual-writes legacy markdown by default inside memoryDomain.addEntryKV)
    // So even if backend=mcp, we always write KV + legacy for safety.
    const kvResult = await addEntryKV(cwd, opts)

    if (cfg.backend === 'mcp' || cfg.backend === 'hybrid') {
      const mcp = this.ensureMcpBackend(cfg)
      try {
        const r = await mcp.addEntry({
          type: opts.type, name: opts.name, description: opts.description,
          body: opts.body, tags: opts.tags,
        })
        if (r.ok) return { ...kvResult, mcpEntry: r.entry }
      } catch (_err) {
        // fall through — we still have kvResult
      }
      if (cfg.backend === 'mcp' && !cfg.mcpFallbackToKV) {
        const err = new Error('[memory/mcp] MCP backend failed and fallback disabled')
        err.cause = 'mcp-down'
        throw err
      }
    }
    return kvResult
  }

  async listEntries(cwd, opts, gcConfig) {
    const cfg = applyMemoryConfig(gcConfig ?? {})
    if (cfg.backend === 'legacy') {
      return legacyList(cwd, opts ?? {})
    }
    if (cfg.backend === 'mcp') {
      const mcp = this.ensureMcpBackend(cfg)
      const r = await mcp.listEntries({ type: opts?.type, limit: opts?.limit ?? 200 })
      if (r.ok) return r.entries
      if (!cfg.mcpFallbackToKV) return []
    }
    // kv / hybrid fallback
    return await listEntriesKV(cwd, opts ?? {})
  }

  async getEntry(cwd, id, gcConfig) {
    const cfg = applyMemoryConfig(gcConfig ?? {})
    if (cfg.backend === 'legacy') {
      return { content: legacyRead(cwd, id) ?? '' }
    }
    if (cfg.backend === 'mcp') {
      const mcp = this.ensureMcpBackend(cfg)
      const r = await mcp.getEntry(id)
      if (r.ok) return r.entry
      if (!cfg.mcpFallbackToKV) return null
    }
    return await getEntryKV(cwd, id, {})
  }

  async removeEntry(cwd, id, gcConfig) {
    const cfg = applyMemoryConfig(gcConfig ?? {})
    // Best-effort remove everywhere. Always try legacy + kv first for consistency.
    let legacyResult = null
    try { legacyResult = legacyRemove(cwd, id, {}) } catch {}
    let kvResult = null
    if (cfg.backend !== 'legacy') {
      try { kvResult = await removeEntryKV(cwd, id, {}) } catch {}
    }
    if (cfg.backend === 'mcp' || cfg.backend === 'hybrid') {
      const mcp = this.ensureMcpBackend(cfg)
      try { await mcp.removeEntry(id) } catch {}
    }
    if (legacyResult) return legacyResult
    if (kvResult) return kvResult
    return { ok: true }
  }

  async searchEntries(cwd, { query, type, limit = 10 }, gcConfig) {
    const cfg = applyMemoryConfig(gcConfig ?? {})
    if (cfg.backend === 'mcp' || cfg.backend === 'hybrid') {
      const mcp = this.ensureMcpBackend(cfg)
      try {
        const r = await mcp.searchEntries({ query, type, limit })
        if (r.ok && r.entries && r.entries.length > 0) return r.entries
      } catch {}
      if (cfg.backend === 'mcp' && !cfg.mcpFallbackToKV) return []
    }
    if (cfg.backend === 'legacy') {
      const all = legacyList(cwd, {})
      const q = (query ?? '').toLowerCase()
      return all.filter((e) => {
        const hay = `${e.name || ''} ${e.description || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
        if (type && String(type).toLowerCase() !== String(e.type ?? 'project').toLowerCase()) return false
        return true
      }).slice(0, limit)
    }
    // KV simple substring search
    const all = await listEntriesKV(cwd, {})
    const q = (query ?? '').toLowerCase()
    return all.filter((e) => {
      const hay = `${e.name || ''} ${e.description || ''} ${e.content || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
      if (type && String(type).toLowerCase() !== String(e.type ?? 'project').toLowerCase()) return false
      return true
    }).slice(0, limit)
  }

  /**
   * Build the <memory> block for the system prompt.
   * Mirrors the original memdir.loadMemoryForPrompt signature so QueryEngine
   * can swap one import.
   */
  async buildMemoryPrompt(cwd, opts, gcConfig) {
    const enabled = (gcConfig && gcConfig.memoryEnabled === false) ? false : true
    if (!enabled) return null
    const cfg = applyMemoryConfig(gcConfig ?? {})

    if (cfg.backend === 'legacy') {
      return legacyLoadPrompt(cwd, { enabled: true, baseDir: opts?.baseDir }) ?? null
    }

    if (cfg.backend === 'mcp' || cfg.backend === 'hybrid') {
      const mcp = this.ensureMcpBackend(cfg)
      try {
        const r = await mcp.loadMemoryForPrompt(cwd, {
          maxEntries: cfg.maxPromptEntries,
          maxBodyChars: cfg.maxPromptBodyChars,
          query: opts?.relevanceQuery ?? null,
        })
        if (r) return r
      } catch {}
      if (cfg.backend === 'mcp' && !cfg.mcpFallbackToKV) {
        // MCP unavailable and fallback disabled → no memory this round
        return null
      }
    }
    return await loadMemoryForPromptKV(cwd, { baseDir: opts?.baseDir, ...opts })
  }

  async migrateLegacyToKV(cwd, opts, gcConfig) {
    applyMemoryConfig(gcConfig ?? {})
    return await migrateLegacyMarkdownToKV(cwd, opts ?? {})
  }

  async stats(gcConfig) {
    const cfg = applyMemoryConfig(gcConfig ?? {})
    const kv = await getMemoryStatsKV()
    const mcpServers = discoverMemoryServers()
    const mcpCaps = []
    for (const s of mcpServers.slice(0, 5)) {
      try { mcpCaps.push({ server: s, caps: await serverCapabilities(s) }) } catch {}
    }
    return {
      config: cfg,
      kv,
      mcp: {
        connectedServers: mcpServers,
        details: mcpCaps,
      },
    }
  }
}

export const memory = new MemoryRegistry()

// Re-export for users who want to build their own
export { McpMemoryBackend, discoverMemoryServers, serverCapabilities }
