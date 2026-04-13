// ============================================================
//  Guang Code — Config File Manager
//  Persists API keys & settings to ~/.guang-code/config.json
// ============================================================

import { readFile, writeFile, mkdir } from 'fs/promises'
import { join, resolve } from 'path'
import { homedir } from 'os'
import type { GcConfig, PermissionMode, ProviderId, ProviderConfig, TrustedProjectConfig } from '../types/index.js'
import { decryptFromStore, encryptForStore, preferredSecretStore } from './secureStore.js'

export const GC_DIR = join(homedir(), '.guang-code')
export const CONFIG_PATH = join(GC_DIR, 'config.json')

const DEFAULT_CONFIG: GcConfig = {
  version: 1,
  defaultModel: 'claude-3-5-sonnet-20241022',
  defaultMode: 'default',
  providers: {},
  autoDelegate: false,
  outputStyle: 'default',
  permissionRules: [],
  memoryEnabled: true,
  trustedProjects: {},
}

export async function loadConfig(): Promise<GcConfig> {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<GcConfig>
    // Merge with defaults so new fields always exist
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      providers: { ...DEFAULT_CONFIG.providers, ...parsed.providers },
      trustedProjects: { ...DEFAULT_CONFIG.trustedProjects, ...parsed.trustedProjects },
    }
  } catch {
    // First run — return defaults
    return { ...DEFAULT_CONFIG }
  }
}

export async function saveConfig(config: GcConfig): Promise<void> {
  await mkdir(GC_DIR, { recursive: true })
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8')
}

export async function setProviderKey(
  providerId: ProviderId,
  apiKey: string,
  extra?: Partial<ProviderConfig>,
): Promise<void> {
  const cfg = await loadConfig()
  const store = preferredSecretStore()
  const enc = encryptForStore(apiKey, store)
  const prev = cfg.providers[providerId] ?? {}
  const next: ProviderConfig = { ...prev, ...extra }
  if (enc.kind === 'windows-dpapi') {
    delete (next as any).apiKey
    next.apiKeyEnc = enc.value
    next.apiKeyStore = enc.kind
  } else {
    next.apiKey = apiKey
    delete (next as any).apiKeyEnc
    delete (next as any).apiKeyStore
  }
  cfg.providers[providerId] = next
  await saveConfig(cfg)
}

export async function setDefaultModel(model: string): Promise<void> {
  const cfg = await loadConfig()
  cfg.defaultModel = model
  await saveConfig(cfg)
}

export async function setDefaultMode(mode: PermissionMode): Promise<void> {
  const cfg = await loadConfig()
  cfg.defaultMode = mode
  await saveConfig(cfg)
}

export async function setOutputStyle(style: GcConfig['outputStyle']): Promise<void> {
  const cfg = await loadConfig()
  cfg.outputStyle = style ?? 'default'
  await saveConfig(cfg)
}

export async function setMemoryEnabled(enabled: boolean): Promise<void> {
  const cfg = await loadConfig()
  cfg.memoryEnabled = enabled
  await saveConfig(cfg)
}

export async function setMemoryDirectory(dir: string | null): Promise<void> {
  const cfg = await loadConfig()
  cfg.memoryDirectory = dir && dir.trim() ? dir.trim() : undefined
  await saveConfig(cfg)
}

export async function addPermissionRule(rule: NonNullable<GcConfig['permissionRules']>[number]): Promise<void> {
  const cfg = await loadConfig()
  if (!cfg.permissionRules) cfg.permissionRules = []
  cfg.permissionRules.push(rule)
  await saveConfig(cfg)
}

export async function removePermissionRule(index: number): Promise<void> {
  const cfg = await loadConfig()
  if (!cfg.permissionRules || cfg.permissionRules.length === 0) return
  if (index < 0 || index >= cfg.permissionRules.length) return
  cfg.permissionRules.splice(index, 1)
  await saveConfig(cfg)
}

export async function clearPermissionRules(): Promise<void> {
  const cfg = await loadConfig()
  cfg.permissionRules = []
  await saveConfig(cfg)
}

export async function addAlwaysAllowRule(rule: string): Promise<void> {
  const cfg = await loadConfig()
  if (!cfg.alwaysAllowRules) {
    cfg.alwaysAllowRules = []
  }
  if (!cfg.alwaysAllowRules.includes(rule)) {
    cfg.alwaysAllowRules.push(rule)
    await saveConfig(cfg)
  }
}

function normalizeProjectKey(cwd: string): string {
  const abs = resolve(cwd)
  return process.platform === 'win32' ? abs.toLowerCase() : abs
}

export async function setTrustedProjectConfig(opts: {
  cwd: string
  kind: keyof TrustedProjectConfig
  hash: string | null
}): Promise<void> {
  const cfg = await loadConfig()
  if (!cfg.trustedProjects) cfg.trustedProjects = {}
  const key = normalizeProjectKey(opts.cwd)
  const entry: TrustedProjectConfig = { ...(cfg.trustedProjects[key] ?? {}) }
  if (opts.hash) {
    ;(entry as any)[opts.kind] = { hash: opts.hash }
  } else {
    delete (entry as any)[opts.kind]
  }
  cfg.trustedProjects[key] = entry
  await saveConfig(cfg)
}

export function getTrustedProjectConfigHash(config: GcConfig, cwd: string, kind: keyof TrustedProjectConfig): string | null {
  const key = normalizeProjectKey(cwd)
  const entry = config.trustedProjects?.[key]
  const v = (entry as any)?.[kind]?.hash
  return typeof v === 'string' && v ? v : null
}

// ── Provider detection ────────────────────────────────────────────

/**
 * Infer which provider should handle a given model name.
 *
 * Routing rules:
 *   claude-*           → anthropic
 *   gpt-* | o1* | o3*  → openai
 *   minimax-*          → minimax
 *   deepseek-*         → openai-compatible (DeepSeek uses OAI-compatible API)
 *   anything else      → openai-compatible (user-configured base URL)
 */
export function inferProvider(model: string): ProviderId {
  const m = model.toLowerCase()
  if (m.startsWith('claude')) return 'anthropic'
  if (m.startsWith('gpt') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4')) return 'openai'
  // MiniMax model names: "MiniMax-Text-01", "abab6.5s-chat", "abab5.5s-chat", etc.
  if (m.startsWith('minimax') || m.startsWith('abab')) return 'minimax'
  return 'openai-compatible'
}

/**
 * Resolve API key for a provider. Priority:
 * 1. env var (ANTHROPIC_API_KEY / OPENAI_API_KEY / MINIMAX_API_KEY / GC_API_KEY)
 * 2. config file
 */
export function resolveApiKey(
  providerId: ProviderId,
  config: GcConfig,
  envOverride?: string,
): string {
  // 1. explicit override (from --api-key flag)
  if (envOverride) return envOverride

  // 2. provider-specific env vars
  const envMap: Record<ProviderId, string> = {
    anthropic: process.env.ANTHROPIC_API_KEY ?? '',
    openai: process.env.OPENAI_API_KEY ?? '',
    minimax: process.env.MINIMAX_API_KEY ?? '',
    'openai-compatible': process.env.GC_API_KEY ?? process.env.OPENAI_API_KEY ?? '',
  }
  if (envMap[providerId]) return envMap[providerId]

  // 3. config file
  const pcfg = config.providers[providerId]
  if (!pcfg) return ''
  if (pcfg.apiKey) return pcfg.apiKey
  if (pcfg.apiKeyEnc) {
    const kind = (pcfg.apiKeyStore ?? 'windows-dpapi') as any
    try {
      return decryptFromStore(pcfg.apiKeyEnc, kind)
    } catch {
      return ''
    }
  }
  return ''
}

export async function migratePlaintextKeysIfNeeded(config: GcConfig): Promise<GcConfig> {
  if (preferredSecretStore() !== 'windows-dpapi') return config
  let changed = false
  const next: GcConfig = { ...config, providers: { ...config.providers } }
  for (const pid of Object.keys(next.providers) as ProviderId[]) {
    const pcfg = next.providers[pid]
    if (!pcfg) continue
    if (pcfg.apiKey && !pcfg.apiKeyEnc) {
      const enc = encryptForStore(pcfg.apiKey, 'windows-dpapi')
      const updated: ProviderConfig = { ...pcfg, apiKeyEnc: enc.value, apiKeyStore: enc.kind }
      delete (updated as any).apiKey
      next.providers[pid] = updated
      changed = true
    }
  }
  if (changed) {
    await saveConfig(next)
  }
  return next
}
