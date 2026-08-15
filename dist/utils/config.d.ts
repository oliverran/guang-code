import type { GcConfig, PermissionMode, ProviderId, ProviderConfig, TrustedProjectConfig } from '../types/index.js';
export declare const GC_DIR: string;
export declare const CONFIG_PATH: string;
export declare function loadConfig(): Promise<GcConfig>;
export declare function saveConfig(config: GcConfig): Promise<void>;
export declare function setProviderKey(providerId: ProviderId, apiKey: string, extra?: Partial<ProviderConfig>): Promise<void>;
export declare function setDefaultModel(model: string): Promise<void>;
export declare function setDefaultMode(mode: PermissionMode): Promise<void>;
export declare function setOutputStyle(style: GcConfig['outputStyle']): Promise<void>;
export declare function setMemoryEnabled(enabled: boolean): Promise<void>;
export declare function setMemoryDirectory(dir: string | null): Promise<void>;
export declare function addPermissionRule(rule: NonNullable<GcConfig['permissionRules']>[number]): Promise<void>;
export declare function removePermissionRule(index: number): Promise<void>;
export declare function clearPermissionRules(): Promise<void>;
export declare function addAlwaysAllowRule(rule: string): Promise<void>;
export declare function setTrustedProjectConfig(opts: {
    cwd: string;
    kind: keyof TrustedProjectConfig;
    hash: string | null;
}): Promise<void>;
export declare function getTrustedProjectConfigHash(config: GcConfig, cwd: string, kind: keyof TrustedProjectConfig): string | null;
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
export declare function inferProvider(model: string): ProviderId;
/**
 * Resolve API key for a provider. Priority:
 * 1. env var (ANTHROPIC_API_KEY / OPENAI_API_KEY / MINIMAX_API_KEY / GC_API_KEY)
 * 2. config file
 */
export declare function resolveApiKey(providerId: ProviderId, config: GcConfig, envOverride?: string): string;
export declare function migratePlaintextKeysIfNeeded(config: GcConfig): Promise<GcConfig>;
