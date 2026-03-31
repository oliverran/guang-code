// ============================================================
//  Guang Code — Provider Registry & Factory
// ============================================================

import type { LLMProvider, ProviderId, GcConfig } from '../types/index.js'
import { AnthropicProvider } from './AnthropicProvider.js'
import { OpenAIProvider } from './OpenAIProvider.js'
import { MiniMaxProvider } from './MiniMaxProvider.js'
import { inferProvider, resolveApiKey } from '../utils/config.js'

/**
 * All known models with their display info.
 * Used in /model and /providers commands.
 */
export const KNOWN_MODELS: Array<{
  id: string
  provider: ProviderId
  displayName: string
  contextWindow: string
  pricing: string
}> = [
  // ── Anthropic ────────────────────────────────────────────
  { id: 'claude-opus-4-5',              provider: 'anthropic', displayName: 'Claude Opus 4.5',         contextWindow: '200K', pricing: '$15/$75 per 1M' },
  { id: 'claude-sonnet-4-5',            provider: 'anthropic', displayName: 'Claude Sonnet 4.5',       contextWindow: '200K', pricing: '$3/$15 per 1M'  },
  { id: 'claude-haiku-4-5',             provider: 'anthropic', displayName: 'Claude Haiku 4.5',        contextWindow: '200K', pricing: '$0.8/$4 per 1M'  },
  { id: 'claude-3-5-sonnet-20241022',   provider: 'anthropic', displayName: 'Claude 3.5 Sonnet',       contextWindow: '200K', pricing: '$3/$15 per 1M'   },
  { id: 'claude-3-5-haiku-20241022',    provider: 'anthropic', displayName: 'Claude 3.5 Haiku',        contextWindow: '200K', pricing: '$0.8/$4 per 1M'  },
  { id: 'claude-3-opus-20240229',       provider: 'anthropic', displayName: 'Claude 3 Opus',           contextWindow: '200K', pricing: '$15/$75 per 1M'  },
  // ── OpenAI ───────────────────────────────────────────────
  { id: 'gpt-5.3',                      provider: 'openai',    displayName: 'GPT-5.3',                contextWindow: '128K', pricing: '$Unknown'        },
  { id: 'gpt-4o',                       provider: 'openai',    displayName: 'GPT-4o',                  contextWindow: '128K', pricing: '$5/$15 per 1M'   },
  { id: 'gpt-4o-mini',                  provider: 'openai',    displayName: 'GPT-4o Mini',             contextWindow: '128K', pricing: '$0.15/$0.6 per 1M'},
  { id: 'gpt-4-turbo',                  provider: 'openai',    displayName: 'GPT-4 Turbo',             contextWindow: '128K', pricing: '$10/$30 per 1M'  },
  { id: 'o3',                           provider: 'openai',    displayName: 'o3 (reasoning)',           contextWindow: '200K', pricing: '$10/$40 per 1M'  },
  { id: 'o4-mini',                      provider: 'openai',    displayName: 'o4-mini (reasoning)',      contextWindow: '200K', pricing: '$1.1/$4.4 per 1M'},
  // ── MiniMax ──────────────────────────────────────────────
  { id: 'MiniMax-Text-01',              provider: 'minimax',   displayName: 'MiniMax Text-01',         contextWindow: '1M',   pricing: '¥1/¥8 per 1M'   },
  { id: 'abab6.5s-chat',               provider: 'minimax',   displayName: 'MiniMax ABAB6.5s',        contextWindow: '245K', pricing: '¥1/¥8 per 1M'   },
  { id: 'minimax-m2.7',                 provider: 'minimax',   displayName: 'MiniMax m2.7',            contextWindow: '245K', pricing: 'Unknown'        },
  // ── OpenAI-compatible (popular open/3rd-party) ───────────
  { id: 'deepseek-chat',               provider: 'openai-compatible', displayName: 'DeepSeek-V3',     contextWindow: '64K',  pricing: '$0.27/$1.1 per 1M'},
  { id: 'deepseek-reasoner',           provider: 'openai-compatible', displayName: 'DeepSeek-R1',     contextWindow: '64K',  pricing: '$0.55/$2.19 per 1M'},
]

/**
 * Create an LLMProvider instance given a model name and config.
 * Automatically infers the provider from the model name.
 */
export function createProvider(
  model: string,
  config: GcConfig,
  apiKeyOverride?: string,
): LLMProvider {
  const providerId = inferProvider(model)
  const apiKey = resolveApiKey(providerId, config, apiKeyOverride)

  if (!apiKey) {
    throw new Error(
      `No API key found for provider "${providerId}".\n` +
      `Run: guang /keys ${providerId} YOUR_KEY\n` +
      `Or set the environment variable:\n` +
      keyEnvHint(providerId),
    )
  }

  switch (providerId) {
    case 'anthropic':
      return new AnthropicProvider(apiKey)

    case 'openai': {
      const baseUrl =
        config.providers['openai']?.baseUrl ??
        process.env.OPENAI_BASE_URL
      return new OpenAIProvider(apiKey, baseUrl ? { baseUrl } : undefined)
    }

    case 'minimax': {
      const baseUrl =
        config.providers['minimax']?.baseUrl ??
        process.env.MINIMAX_BASE_URL
      return new MiniMaxProvider(apiKey, baseUrl)
    }

    case 'openai-compatible': {
      const baseUrl =
        config.providers['openai-compatible']?.baseUrl ??
        process.env.GC_BASE_URL ??
        process.env.OPENAI_BASE_URL
      if (!baseUrl) {
        // Try to infer base URL from common model names
        const inferredBase = inferBaseUrl(model)
        return new OpenAIProvider(apiKey, { baseUrl: inferredBase, providerId: 'openai-compatible' })
      }
      return new OpenAIProvider(apiKey, { baseUrl, providerId: 'openai-compatible' })
    }
  }
}

function keyEnvHint(id: ProviderId): string {
  const map: Record<ProviderId, string> = {
    anthropic: 'ANTHROPIC_API_KEY=sk-ant-...',
    openai: 'OPENAI_API_KEY=sk-...',
    minimax: 'MINIMAX_API_KEY=...',
    'openai-compatible': 'GC_API_KEY=...  (and optionally GC_BASE_URL=https://...)',
  }
  return map[id]
}

/** Infer base URL from well-known model name prefixes */
function inferBaseUrl(model: string): string | undefined {
  const m = model.toLowerCase()
  if (m.startsWith('deepseek')) return 'https://api.deepseek.com/v1'
  if (m.startsWith('qwen'))     return 'https://dashscope.aliyuncs.com/compatible-mode/v1'
  if (m.startsWith('glm'))      return 'https://open.bigmodel.cn/api/paas/v4'
  return undefined
}
