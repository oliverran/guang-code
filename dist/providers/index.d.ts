import type { LLMProvider, ProviderId, GcConfig } from '../types/index.js';
/**
 * All known models with their display info.
 * Used in /model and /providers commands.
 */
export declare const KNOWN_MODELS: Array<{
    id: string;
    provider: ProviderId;
    displayName: string;
    contextWindow: string;
    pricing: string;
}>;
/**
 * Create an LLMProvider instance given a model name and config.
 * Automatically infers the provider from the model name.
 */
export declare function createProvider(model: string, config: GcConfig, apiKeyOverride?: string): LLMProvider;
