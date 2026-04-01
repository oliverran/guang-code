// ============================================================
//  Guang Code — Slash Commands
// ============================================================

import type { SlashCommand, AppState, SetState } from '../types/index.js'
import { getTools } from '../tools/index.js'
import { AgentTool } from '../tools/AgentTool.js'
import { listSessions } from '../utils/sessionStorage.js'
import { setProviderKey, setDefaultModel, setDefaultMode, loadConfig, setOutputStyle, addPermissionRule, removePermissionRule, clearPermissionRules } from '../utils/config.js'
import { KNOWN_MODELS } from '../providers/index.js'
import { loadCustomCommands } from '../utils/customCommands.js'
import { isGitRepo, getGitStatus, getGitDiff, getCurrentBranch } from '../utils/git.js'
import { subagentTasks } from '../utils/subagentTasks.js'
import { randomUUID } from 'crypto'

// ── /help ─────────────────────────────────────────────────────────────────────
const helpCommand: SlashCommand = {
  name: 'help',
  description: 'Show available commands and keyboard shortcuts',
  async execute(_args, state, _setState) {
    const tools = getTools()
    const toolList = tools.map(t => `  • ${t.name.padEnd(14)} ${t.description.slice(0, 56)}`).join('\n')

    const allCommands = getAllSlashCommands(state.cwd)
    const customCommands = allCommands.filter(c => !builtInSlashCommands.some(bc => bc.name === c.name))
    
    let customCommandsSection = ''
    if (customCommands.length > 0) {
      const customList = customCommands.map(c => `  /${c.name.padEnd(18)} ${c.description.slice(0, 56)}`).join('\n')
      customCommandsSection = `\nCUSTOM COMMANDS:\n${customList}\n`
    }

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
  /style [name]       Switch output style (default/explanatory/learning)
  /permissions ...    Manage fine-grained permission rules
  /compact            Summarize and compress conversation history
  /sessions           List recent sessions
  /tasks              List background sub-agent tasks
  /task-cancel <id>   Cancel a running task
  /task-retry <id>    Retry a failed task (spawns a new one)
  /send <id> <msg>    Send a follow-up message to a running task
  /exit               Exit Guang Code
${customCommandsSection}
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

// ── /tasks ────────────────────────────────────────────────────────────────────
const tasksCommand: SlashCommand = {
  name: 'tasks',
  description: 'List background sub-agent tasks',
  async execute(_args, _state, _setState) {
    const tasks = subagentTasks.list().slice(0, 20)
    if (tasks.length === 0) return 'No background tasks.'
    const lines = tasks.map(t => {
      const name = t.name ? ` (${t.name})` : ''
      const age = Math.round((Date.now() - t.createdAt) / 1000)
      return `- ${t.id.slice(0, 8)}${name}  ${t.status}  ${age}s  ${t.description}`
    })
    return `Tasks:\n${lines.join('\n')}`
  },
}

// ── /task-cancel ──────────────────────────────────────────────────────────────
const taskCancelCommand: SlashCommand = {
  name: 'task-cancel',
  description: 'Cancel a running background task: /task-cancel <id|name>',
  async execute(args, _state, _setState) {
    const id = args.trim()
    if (!id) return 'Usage: /task-cancel <id|name>'
    const res = subagentTasks.cancel(id)
    if (!res.ok) return res.error ?? 'Cancel failed'
    return `Cancelled task: ${id}`
  },
}

// ── /task-retry ───────────────────────────────────────────────────────────────
const taskRetryCommand: SlashCommand = {
  name: 'task-retry',
  description: 'Retry a task by id or name (spawns a new background task)',
  async execute(args, state, _setState) {
    const id = args.trim()
    if (!id) return 'Usage: /task-retry <id|name>'
    const task = subagentTasks.get(id)
    if (!task) return `Task not found: ${id}`
    if (task.status === 'running') return `Task is still running: ${task.id.slice(0, 8)}`

    const input = { ...task.params, run_in_background: 'true' } as Record<string, unknown>
    const res = await AgentTool.execute(input, {
      cwd: state.cwd,
      permissionMode: state.permissionMode,
      model: state.model,
      providerConfig: state.providerConfig,
      onPermissionRequest: async () => 'deny',
    })
    return res.isError ? `Retry failed: ${res.content}` : `Retry started: ${res.content}`
  },
}

// ── /send ─────────────────────────────────────────────────────────────────────
const sendCommand: SlashCommand = {
  name: 'send',
  description: 'Send a follow-up message to a running task: /send <id|name> <message>',
  async execute(args, _state, _setState) {
    const trimmed = args.trim()
    if (!trimmed) return 'Usage: /send <id|name> <message>'
    const firstSpace = trimmed.indexOf(' ')
    if (firstSpace < 0) return 'Usage: /send <id|name> <message>'
    const to = trimmed.slice(0, firstSpace).trim()
    const message = trimmed.slice(firstSpace + 1)
    const res = subagentTasks.enqueueMessage(to, message)
    if (!res.ok) return res.error ?? 'Send failed'
    return `Sent to ${to}`
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

// ── /commit ───────────────────────────────────────────────────────────────────
const commitCommand: SlashCommand = {
  name: 'commit',
  description: 'Create a git commit with AI-generated message',
  async execute(_args, state, _setState) {
    if (!(await isGitRepo(state.cwd))) {
      return "Error: Current directory is not a git repository."
    }

    const status = await getGitStatus(state.cwd)
    if (!status) {
      return "No changes to commit. Working tree is clean."
    }

    const diff = await getGitDiff(state.cwd)
    const branch = await getCurrentBranch(state.cwd)

    const prompt = `
[System: Executing /commit command]

Please analyze the following git changes and create a suitable commit message.

## Context
- Current branch: ${branch}
- Status:
${status}
- Diff:
${diff.slice(0, 4000)} ${diff.length > 4000 ? '\n... (diff truncated)' : ''}

## Task
1. Stage all changes using the BashTool (git add .)
2. Create a concise, meaningful commit message (1-2 lines)
3. Execute the commit using the BashTool (git commit -m "...")
4. Summarize what you committed
`
    return prompt
  },
}

// ── /style ────────────────────────────────────────────────────────────────────
const styleCommand: SlashCommand = {
  name: 'style',
  description: 'Switch output style (default/explanatory/learning)',
  async execute(args, state, setState) {
    const next = args.trim().toLowerCase()
    const cfg = await loadConfig()
    const current = cfg.outputStyle ?? 'default'

    if (!next) {
      return [
        `Current output style: ${current}`,
        '',
        'Available styles:',
        '  • default',
        '  • explanatory',
        '  • learning',
        '',
        'Usage: /style <name>',
      ].join('\n')
    }

    if (next !== 'default' && next !== 'explanatory' && next !== 'learning') {
      return `Unknown style: ${next}. Use: default | explanatory | learning`
    }

    await setOutputStyle(next as any)
    const updated = await loadConfig()
    setState(prev => ({ ...prev, providerConfig: updated }))
    return `Output style set to: ${next}`
  },
}

// ── /permissions ──────────────────────────────────────────────────────────────
const permissionsCommand: SlashCommand = {
  name: 'permissions',
  description: 'Manage fine-grained permission rules',
  async execute(args, state, setState) {
    const trimmed = args.trim()
    const [sub, ...rest] = trimmed.split(/\s+/)
    const cmd = (sub || 'list').toLowerCase()

    const cfg = await loadConfig()
    const rules = cfg.permissionRules ?? []

    if (cmd === 'list') {
      if (rules.length === 0) {
        return [
          'No permission rules configured.',
          '',
          'Usage:',
          '  /permissions add <allow|deny|ask> <tool> [path=<pattern>] [command=<pattern>]',
          '  /permissions remove <index>',
          '  /permissions clear',
        ].join('\n')
      }

      const lines = rules.map((r, i) => {
        const parts = [
          `${String(i).padStart(2)}  ${r.effect}`,
          r.tool ? `tool=${r.tool}` : null,
          r.path ? `path=${r.path}` : null,
          r.command ? `command=${r.command}` : null,
          r.description ? `desc=${r.description}` : null,
        ].filter(Boolean)
        return parts.join('  ')
      })
      return ['Permission rules:', ...lines, '', 'Usage: /permissions add|remove|clear|list'].join('\n')
    }

    if (cmd === 'clear') {
      await clearPermissionRules()
      const updated = await loadConfig()
      setState(prev => ({ ...prev, providerConfig: updated }))
      return 'Permission rules cleared.'
    }

    if (cmd === 'remove') {
      const idxRaw = rest[0]
      const idx = idxRaw ? Number(idxRaw) : NaN
      if (!Number.isFinite(idx)) return 'Usage: /permissions remove <index>'
      await removePermissionRule(idx)
      const updated = await loadConfig()
      setState(prev => ({ ...prev, providerConfig: updated }))
      return `Removed rule #${idx}.`
    }

    if (cmd === 'add') {
      const [effectRaw, toolRaw, ...kv] = rest
      const effect = (effectRaw || '').toLowerCase()
      const tool = toolRaw || ''
      if (!tool || (effect !== 'allow' && effect !== 'deny' && effect !== 'ask')) {
        return 'Usage: /permissions add <allow|deny|ask> <tool> [path=<pattern>] [command=<pattern>]'
      }

      const rule: any = { effect, tool }
      for (const pair of kv) {
        const eq = pair.indexOf('=')
        if (eq < 0) continue
        const k = pair.slice(0, eq).toLowerCase()
        const v = pair.slice(eq + 1)
        if (!v) continue
        if (k === 'path') rule.path = v
        if (k === 'command') rule.command = v
        if (k === 'desc' || k === 'description') rule.description = v
      }

      await addPermissionRule(rule)
      const updated = await loadConfig()
      setState(prev => ({ ...prev, providerConfig: updated }))
      return `Added rule: ${effect} tool=${tool}${rule.path ? ` path=${rule.path}` : ''}${rule.command ? ` command=${rule.command}` : ''}`
    }

    return 'Usage: /permissions add|remove|clear|list'
  },
}

// ── Registry ──────────────────────────────────────────────────────────────────
export const builtInSlashCommands: SlashCommand[] = [
  helpCommand,
  clearCommand,
  costCommand,
  modelCommand,
  providersCommand,
  keysCommand,
  modeCommand,
  styleCommand,
  permissionsCommand,
  compactCommand,
  sessionsCommand,
  tasksCommand,
  taskCancelCommand,
  taskRetryCommand,
  sendCommand,
  commitCommand,
  exitCommand,
]

export function getAllSlashCommands(cwd: string): SlashCommand[] {
  const customCommands = loadCustomCommands(cwd)
  return [...builtInSlashCommands, ...customCommands]
}

export function findSlashCommand(input: string, cwd: string = process.cwd()): { command: SlashCommand; args: string } | null {
  if (!input.startsWith('/')) return null
  const [cmdPart, ...rest] = input.slice(1).split(' ')
  const args    = rest.join(' ')
  const allCommands = getAllSlashCommands(cwd)
  const command = allCommands.find(c => c.name === cmdPart?.toLowerCase())
  if (!command) return null
  return { command, args }
}
