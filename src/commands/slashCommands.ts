// ============================================================
//  Guang Code — Slash Commands
// ============================================================

import type { SlashCommand, AppState, SetState } from '../types/index.js'
import { getTools } from '../tools/index.js'
import { listSessions } from '../utils/sessionStorage.js'
import { setProviderKey, setDefaultModel, setDefaultMode, loadConfig } from '../utils/config.js'
import { KNOWN_MODELS } from '../providers/index.js'
import { randomUUID } from 'crypto'

// ── /help ─────────────────────────────────────────────────────────────────────
const helpCommand: SlashCommand = {
  name: 'help',
  description: 'Show available commands and keyboard shortcuts',
  async execute(_args, _state, _setState) {
    const tools = getTools()
    const toolList = tools.map(t => `  • ${t.name.padEnd(14)} ${t.description.slice(0, 56)}`).join('\n')

    return `
╔══════════════════════════════════════════════════════════╗
║                   Guang Code — Help                      ║
╚══════════════════════════════════════════════════════════╝

SLASH COMMANDS:
  /help               Show this help
  /clear              Clear conversation history
  /cost               Show token usage and cost estimate
  /model [name]       Switch AI model (shows list if no arg)
  /providers          List all supported models & providers
  /keys <id> <key>    Set an API key (saves to ~/.guang-code/config.json)
  /mode <mode>        Switch permission mode (default/auto/plan)
  /compact            Summarize and compress conversation history
  /sessions           List recent sessions
  /exit               Exit Guang Code

KEYBOARD SHORTCUTS:
  Enter               Send message
  Ctrl+C              Cancel current request
  Ctrl+D              Exit
  ↑ / ↓              Browse message history

AVAILABLE TOOLS:
${toolList}

PERMISSION MODES:
  default  Ask before running bash commands and file writes
  auto     Execute all tools without asking (use with care!)
  plan     Read-only mode — get a plan approved before writing

TIPS:
  • Run /keys anthropic sk-ant-... to save your Anthropic key
  • Run /keys openai sk-... to save your OpenAI key
  • Run /keys minimax <key> to save your MiniMax key
  • Use /model gpt-4o to switch to GPT-4o mid-session
    `.trim()
  },
}

// ── /clear ────────────────────────────────────────────────────────────────────
const clearCommand: SlashCommand = {
  name: 'clear',
  description: 'Clear conversation history and start fresh',
  async execute(_args, _state, setState) {
    setState(prev => ({
      ...prev,
      messages: [],
      inputTokens: 0,
      outputTokens: 0,
      error: null,
    }))
    return null
  },
}

// ── /cost ─────────────────────────────────────────────────────────────────────
const costCommand: SlashCommand = {
  name: 'cost',
  description: 'Show current session token usage and cost estimate',
  async execute(_args, state, _setState) {
    const { inputTokens, outputTokens, model } = state

    // Build cost table from KNOWN_MODELS
    const costs: Record<string, { input: number; output: number }> = {}
    for (const m of KNOWN_MODELS) {
      const match = m.pricing.match(/\$([\d.]+)\/\$([\d.]+)/)
      if (match) {
        costs[m.id] = { input: parseFloat(match[1]), output: parseFloat(match[2]) }
      }
    }

    const modelCost = costs[model] ?? { input: 3.0, output: 15.0 }
    const inputCost  = (inputTokens  / 1_000_000) * modelCost.input
    const outputCost = (outputTokens / 1_000_000) * modelCost.output
    const totalCost  = inputCost + outputCost

    return `
TOKEN USAGE  (model: ${model})
  Input tokens:   ${inputTokens.toLocaleString()}
  Output tokens:  ${outputTokens.toLocaleString()}
  Total tokens:   ${(inputTokens + outputTokens).toLocaleString()}

ESTIMATED COST
  Input:   $${inputCost.toFixed(5)}
  Output:  $${outputCost.toFixed(5)}
  Total:   $${totalCost.toFixed(5)}
    `.trim()
  },
}

// ── /model ────────────────────────────────────────────────────────────────────
const modelCommand: SlashCommand = {
  name: 'model',
  description: 'Switch AI model  (e.g. /model gpt-4o)',
  async execute(args, state, setState) {
    const model = args.trim()

    if (!model) {
      // Show compact list grouped by provider
      const byProvider: Record<string, typeof KNOWN_MODELS> = {}
      for (const m of KNOWN_MODELS) {
        if (!byProvider[m.provider]) byProvider[m.provider] = []
        byProvider[m.provider].push(m)
      }

      const lines: string[] = [`Current model: ${state.model}\n`, 'Available models:']
      for (const [pid, models] of Object.entries(byProvider)) {
        lines.push(`\n  [${pid}]`)
        for (const m of models) {
          const mark = m.id === state.model ? ' ◀ active' : ''
          lines.push(`  • ${m.id.padEnd(36)} ${m.contextWindow.padEnd(5)} ${m.pricing}${mark}`)
        }
      }
      lines.push('\nUsage: /model <model-id>')
      return lines.join('\n')
    }

    setState(prev => ({ ...prev, model }))

    // Persist to config
    setDefaultModel(model).catch(() => {})

    const known = KNOWN_MODELS.find(m => m.id === model)
    const extra = known ? `  (${known.displayName}, ${known.provider})` : ''
    return `Model switched to: ${model}${extra}`
  },
}

// ── /providers ────────────────────────────────────────────────────────────────
const providersCommand: SlashCommand = {
  name: 'providers',
  description: 'List all supported providers and their models',
  async execute(_args, state, _setState) {
    const cfg = await loadConfig()

    // Show which providers have keys configured
    const providerIds = ['anthropic', 'openai', 'minimax', 'openai-compatible'] as const
    const keyStatus = providerIds.map(pid => {
      const envKey = {
        anthropic: process.env.ANTHROPIC_API_KEY,
        openai: process.env.OPENAI_API_KEY,
        minimax: process.env.MINIMAX_API_KEY,
        'openai-compatible': process.env.GC_API_KEY ?? process.env.OPENAI_API_KEY,
      }[pid]
      const cfgKey = cfg.providers[pid]?.apiKey
      const hasKey = !!(envKey || cfgKey)
      return `  ${hasKey ? '✓' : '✗'} ${pid.padEnd(20)} ${hasKey ? '(key configured)' : '(no key — run /keys ' + pid + ' <KEY>)'}`
    })

    const byProvider: Record<string, typeof KNOWN_MODELS> = {}
    for (const m of KNOWN_MODELS) {
      if (!byProvider[m.provider]) byProvider[m.provider] = []
      byProvider[m.provider].push(m)
    }

    const modelLines: string[] = []
    for (const [pid, models] of Object.entries(byProvider)) {
      modelLines.push(`\n  [${pid}]`)
      for (const m of models) {
        const mark = m.id === state.model ? ' ◀ active' : ''
        modelLines.push(
          `  • ${m.id.padEnd(36)} ${m.contextWindow.padEnd(5)} ${m.pricing}${mark}`
        )
      }
    }

    return [
      'PROVIDER STATUS:',
      ...keyStatus,
      '\nSUPPORTED MODELS:',
      ...modelLines,
      '\nTo add more providers (e.g. DeepSeek):',
      '  /keys openai-compatible <YOUR_KEY>',
      '  then set GC_BASE_URL=https://api.deepseek.com/v1 in your shell',
      '  and /model deepseek-chat',
    ].join('\n')
  },
}

// ── /keys ─────────────────────────────────────────────────────────────────────
const keysCommand: SlashCommand = {
  name: 'keys',
  description: 'Set API key: /keys <provider> <key>  e.g. /keys anthropic sk-ant-...',
  async execute(args, _state, setState) {
    const parts = args.trim().split(/\s+/)

    if (parts.length < 2 || !parts[0] || !parts[1]) {
      return `Usage: /keys <provider> <api-key>

Providers:
  anthropic           (ANTHROPIC_API_KEY)
  openai              (OPENAI_API_KEY)
  minimax             (MINIMAX_API_KEY)
  openai-compatible   (for DeepSeek, Qwen, etc.)

Examples:
  /keys anthropic sk-ant-...
  /keys openai sk-...
  /keys minimax eyJ...
  /keys openai-compatible <KEY>   (also set GC_BASE_URL in shell)

Keys are saved to ~/.guang-code/config.json`
    }

    const [pid, key] = parts as [string, string]
    const validProviders = ['anthropic', 'openai', 'minimax', 'openai-compatible']
    if (!validProviders.includes(pid)) {
      return `Unknown provider "${pid}". Valid: ${validProviders.join(', ')}`
    }

    await setProviderKey(pid as 'anthropic' | 'openai' | 'minimax' | 'openai-compatible', key)

    // Update in-memory config
    setState(prev => ({
      ...prev,
      providerConfig: {
        ...prev.providerConfig,
        providers: {
          ...prev.providerConfig.providers,
          [pid]: { ...prev.providerConfig.providers[pid as keyof typeof prev.providerConfig.providers], apiKey: key },
        },
      },
    }))

    const masked = key.slice(0, 8) + '...' + key.slice(-4)
    return `API key saved for "${pid}": ${masked}\nConfig: ~/.guang-code/config.json`
  },
}

// ── /mode ─────────────────────────────────────────────────────────────────────
const modeCommand: SlashCommand = {
  name: 'mode',
  description: 'Switch permission mode: /mode default | auto | plan',
  async execute(args, _state, setState) {
    const mode = args.trim() as 'default' | 'auto' | 'plan'
    if (!['default', 'auto', 'plan'].includes(mode)) {
      return `Invalid mode. Choose: default, auto, or plan

  default  Ask before bash commands and file writes
  auto     Execute all tools without asking
  plan     Read-only until plan is approved`
    }

    setState(prev => ({ ...prev, permissionMode: mode }))
    setDefaultMode(mode).catch(() => {})
    return `Permission mode switched to: ${mode}`
  },
}

// ── /compact ──────────────────────────────────────────────────────────────────
const compactCommand: SlashCommand = {
  name: 'compact',
  description: 'Compress conversation history to save context space',
  async execute(_args, state, setState) {
    const { messages } = state
    if (messages.length < 4) {
      return 'Conversation is too short to compact.'
    }

    const kept    = messages.slice(-4)
    const dropped = messages.length - kept.length

    const summary: import('../types/index.js').SessionMessage = {
      id: randomUUID(),
      role: 'system',
      content: `[Conversation compacted: ${dropped} earlier messages summarized. Continuing coding session in ${state.cwd}]`,
      timestamp: Date.now(),
    }

    setState(prev => ({ ...prev, messages: [summary, ...kept] }))
    return `Compacted: removed ${dropped} messages, kept last ${kept.length}.`
  },
}

// ── /sessions ─────────────────────────────────────────────────────────────────
const sessionsCommand: SlashCommand = {
  name: 'sessions',
  description: 'List recent sessions',
  async execute(_args, _state, _setState) {
    const sessions = await listSessions()
    if (sessions.length === 0) return 'No saved sessions found.'

    const lines = sessions.slice(0, 10).map((s, i) => {
      const date   = new Date(s.updatedAt).toLocaleString()
      const tokens = s.inputTokens + s.outputTokens
      const msgs   = s.messages.filter(m => m.role !== 'system').length
      return `  ${i + 1}. ${s.id.slice(0, 8)}  ${date}  ${msgs} msgs  ${tokens.toLocaleString()} tokens\n     ${s.cwd}  (${s.model})`
    })

    return `Recent sessions (resume with: guang -r <id>):\n\n${lines.join('\n')}`
  },
}

// ── /exit ─────────────────────────────────────────────────────────────────────
const exitCommand: SlashCommand = {
  name: 'exit',
  description: 'Exit Guang Code',
  async execute() {
    process.exit(0)
  },
}

// ── Registry ──────────────────────────────────────────────────────────────────
export const slashCommands: SlashCommand[] = [
  helpCommand,
  clearCommand,
  costCommand,
  modelCommand,
  providersCommand,
  keysCommand,
  modeCommand,
  compactCommand,
  sessionsCommand,
  exitCommand,
]

export function findSlashCommand(input: string): { command: SlashCommand; args: string } | null {
  if (!input.startsWith('/')) return null
  const [cmdPart, ...rest] = input.slice(1).split(' ')
  const args    = rest.join(' ')
  const command = slashCommands.find(c => c.name === cmdPart?.toLowerCase())
  if (!command) return null
  return { command, args }
}
