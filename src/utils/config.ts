// ============================================================
//  Guang Code — Config File Manager
//  Persists API keys & settings to ~/.guang-code/config.json
// ============================================================

import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import type { GcConfig, PermissionMode, ProviderId, ProviderConfig } from '../types/index.js'

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
  cfg.providers[providerId] = { ...cfg.providers[providerId], apiKey, ...extra }
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
  return config.providers[providerId]?.apiKey ?? ''
}
