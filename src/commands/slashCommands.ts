// ============================================================
//  Guang Code — Slash Commands
// ============================================================

import type { SlashCommand, AppState, SetState } from '../types/index.js'
import { getTools } from '../tools/index.js'
import { AgentTool } from '../tools/AgentTool.js'
import { listSessions, loadSession, saveSession } from '../utils/sessionStorage.js'
import { setProviderKey, setDefaultModel, setDefaultMode, loadConfig, setOutputStyle, setMemoryDirectory, setMemoryEnabled, addPermissionRule, removePermissionRule, clearPermissionRules, setTrustedProjectConfig } from '../utils/config.js'
import { KNOWN_MODELS } from '../providers/index.js'
import { loadCustomCommands } from '../utils/customCommands.js'
import { isGitRepo, getGitStatus, getGitDiff, getCurrentBranch } from '../utils/git.js'
import { subagentTasks } from '../utils/subagentTasks.js'
import { randomUUID } from 'crypto'
import { loadAllSkills, renderSkillInvocation } from '../utils/skills.js'
import { homedir } from 'os'
import { addMemory, ensureMemoryIndexExists, getProjectMemoryDir, listMemoryEntries, readMemoryFile, removeMemory } from '../utils/memdir.js'
import { addProjectCronTask, clearProjectCronTasks, listProjectCronTasks, removeProjectCronTask, setProjectCronTaskEnabled } from '../utils/cronTasks.js'
import { parseCronExpression } from '../utils/cron.js'
import { mkdir, writeFile } from 'fs/promises'
import { dirname, resolve } from 'path'
import { clearPmContext, ingestPmFiles, loadPmContext, renderPmContextForPrompt } from '../utils/pmContext.js'
import { addDecision, exportDecisionLedgerMarkdown, linkDecision, loadDecisionLedger, renderDecisionForPrompt, renderDecisionList } from '../utils/decisionLedger.js'

// ── /help ─────────────────────────────────────────────────────────────────────
const helpCommand: SlashCommand = {
  name: 'help',
  description: 'Show available commands and keyboard shortcuts',
  usage: '/help',
  noArgs: true,
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
  /plan ...           Plan workflow (start/show/approve/reset)
  /style [name]       Switch output style (default/explanatory/learning)
  /permissions ...    Manage fine-grained permission rules
  /skills             List available skills
  /skill <id> [args]  Execute a skill (prompt template)
  /memory ...         Manage persistent project memory
  /cron ...           Manage scheduled tasks (project)
  /compact            Summarize and compress conversation history
  /align ...          Ingest/scan files for alignment
  /decision ...       Decision ledger tools
  /impact ...         Change impact analysis
  /pack ...           Generate an alignment pack
  /sessions           List recent sessions
  /resume <id>        Resume a session in-place
  /session ...        Session tools (new/rename/export)
  /template ...       Templates (prd/story/release/competitor)
  /trust ...          Manage project trust (mcp/hooks)
  /tasks              List background sub-agent tasks
  /task-cancel <id>   Cancel a running task
  /task-retry <id>    Retry a failed task (spawns a new one)
  /send <id> <msg>    Send a follow-up message to a running task
  /exit               Exit Guang Code
${customCommandsSection}
KEYBOARD SHORTCUTS:
  Enter               Send message
  Ctrl+P              Command palette
  Tab                 Slash autocomplete (when input starts with "/")
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
  usage: '/tasks',
  noArgs: true,
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
  usage: '/clear',
  noArgs: true,
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
  usage: '/cost',
  noArgs: true,
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
  usage: '/providers',
  noArgs: true,
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
      const cfgKey = cfg.providers[pid]?.apiKey ?? cfg.providers[pid]?.apiKeyEnc
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
      '\nTo add more providers (OpenAI-compatible gateways, e.g. DeepSeek/Qwen/GLM):',
      '  /keys openai-compatible <YOUR_KEY>',
      '  then set GC_BASE_URL in your shell, e.g.:',
      '    DeepSeek: https://api.deepseek.com/v1',
      '    Qwen:     https://dashscope.aliyuncs.com/compatible-mode/v1',
      '    GLM:      https://open.bigmodel.cn/api/paas/v4',
      '  and /model <model-id> (e.g. deepseek-chat / qwen-plus / glm-4)',
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
  auto     Execute safe tools without asking (denies unsafe tools)
  plan     Read-only until plan is approved`
    }

    setState(prev => ({
      ...prev,
      permissionMode: mode,
      planApproved: mode === 'plan' ? false : prev.planApproved,
      pendingPlan: mode === 'plan' ? prev.pendingPlan : undefined,
    }))
    setDefaultMode(mode).catch(() => {})
    return `Permission mode switched to: ${mode}`
  },
}

// ── /compact ──────────────────────────────────────────────────────────────────
const compactCommand: SlashCommand = {
  name: 'compact',
  description: 'Compress conversation history to save context space',
  usage: '/compact',
  noArgs: true,
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
  usage: '/sessions',
  noArgs: true,
  async execute(_args, _state, _setState) {
    const sessions = await listSessions()
    if (sessions.length === 0) return 'No saved sessions found.'

    const lines = sessions.slice(0, 10).map((s, i) => {
      const date   = new Date(s.updatedAt).toLocaleString()
      const tokens = s.inputTokens + s.outputTokens
      const msgs   = s.messages.filter(m => m.role !== 'system').length
      const title = s.title ? `  ${s.title}` : ''
      return `  ${i + 1}. ${s.id.slice(0, 8)}  ${date}  ${msgs} msgs  ${tokens.toLocaleString()} tokens${title}\n     ${s.cwd}  (${s.model})`
    })

    return `Recent sessions (resume with: guang -r <number|idPrefix|fullId> or /resume ...):\n\n${lines.join('\n')}`
  },
}

// ── /resume ───────────────────────────────────────────────────────────────────
const resumeCommand: SlashCommand = {
  name: 'resume',
  description: 'Resume a saved session in-place: /resume <number|idPrefix|fullId>',
  usage: '/resume <number|idPrefix|fullId>',
  examples: [' /resume 1', ' /resume abcd1234'],
  async execute(args, _state, setState) {
    const raw = args.trim()
    const sessions = await listSessions()
    if (!raw) {
      const lines = sessions.slice(0, 10).map((s, i) => {
        const title = s.title ? `  ${s.title}` : ''
        return `  ${i + 1}. ${s.id.slice(0, 8)}${title}\n     ${s.cwd}  (${s.model})`
      })
      return `Usage: /resume <number|idPrefix|fullId>\n\n${lines.join('\n')}`
    }

    let targetId: string | null = raw
    if (/^\d+$/.test(raw)) {
      const idx = Number(raw)
      const s = Number.isFinite(idx) ? sessions[idx - 1] : undefined
      targetId = s?.id ?? null
    } else if (!/^[0-9a-fA-F-]{32,}$/.test(raw) || raw.length < 32) {
      const pref = raw.toLowerCase()
      const s = sessions.find(x => x.id.toLowerCase().startsWith(pref))
      targetId = s?.id ?? null
    }

    const saved = targetId ? await loadSession(targetId) : null
    if (!saved) return `Session not found: ${raw}`

    setState(prev => ({
      ...prev,
      sessionId: saved.id,
      sessionCreatedAt: saved.createdAt,
      sessionTitle: saved.title,
      messages: saved.messages,
      inputTokens: saved.inputTokens,
      outputTokens: saved.outputTokens,
      model: saved.model,
      cwd: saved.cwd,
      planApproved: false,
      pendingPlan: undefined,
      error: null,
    }))

    return `Resumed session: ${saved.id.slice(0, 8)}  ${saved.title ?? ''}`.trim()
  },
}

// ── /plan ─────────────────────────────────────────────────────────────────────
const planCommand: SlashCommand = {
  name: 'plan',
  description: 'Plan workflow: /plan start|show|approve|reset|status',
  usage: '/plan start|show|approve|reset|status',
  examples: [' /plan start', ' /plan show', ' /plan approve'],
  async execute(args, state, setState) {
    const trimmed = args.trim()
    const [sub] = trimmed.split(/\s+/)
    const cmd = (sub || 'status').toLowerCase()

    if (cmd === 'start') {
      setState(prev => ({ ...prev, permissionMode: 'plan', planApproved: false, pendingPlan: undefined }))
      return 'Plan mode started. Ask your request; review with /plan show; approve with /plan approve.'
    }

    if (cmd === 'show') {
      return state.pendingPlan ? state.pendingPlan : 'No pending plan captured yet.'
    }

    if (cmd === 'approve') {
      if (state.permissionMode !== 'plan') {
        return 'Not in plan mode. Use: /plan start'
      }
      setState(prev => ({ ...prev, planApproved: true }))
      return 'Plan approved. Tool execution is now allowed under normal permission prompts.'
    }

    if (cmd === 'reset') {
      setState(prev => ({ ...prev, planApproved: false, pendingPlan: undefined }))
      return 'Plan reset.'
    }

    if (cmd === 'status') {
      const mode = state.permissionMode
      const approved = state.planApproved ? 'approved' : 'not approved'
      const hasPlan = state.pendingPlan ? 'yes' : 'no'
      return `Plan status:\n- mode: ${mode}\n- approved: ${approved}\n- pending plan: ${hasPlan}`
    }

    return 'Usage: /plan start|show|approve|reset|status'
  },
}

function renderTemplate(name: string, rawArgs: string): string | null {
  const n = (name ?? '').toLowerCase()
  const topic = rawArgs.trim()
  const header = topic ? `# ${topic}\n\n` : ''

  if (n === 'prd') {
    return header + [
      '## 背景',
      '- 问题/机会：',
      '- 目标：',
      '',
      '## 用户与场景',
      '- 目标用户：',
      '- 典型场景：',
      '',
      '## 方案',
      '- 核心流程：',
      '- 交互稿/原型链接：',
      '',
      '## 需求拆解',
      '- Must-have：',
      '- Nice-to-have：',
      '',
      '## 数据与指标',
      '- 指标定义：',
      '- 目标值：',
      '',
      '## 风险与边界',
      '- 风险：',
      '- 不做什么：',
      '',
      '## 里程碑',
      '- 设计：',
      '- 开发：',
      '- 验收/发布：',
    ].join('\n')
  }

  if (n === 'user-story' || n === 'story') {
    return header + [
      '## User Story',
      '- As a ...',
      '- I want ...',
      '- So that ...',
      '',
      '## Acceptance Criteria',
      '- Given ... When ... Then ...',
      '- Given ... When ... Then ...',
      '',
      '## Notes',
      '- 约束：',
      '- 埋点：',
      '- 依赖：',
    ].join('\n')
  }

  if (n === 'release-note' || n === 'release') {
    return header + [
      '## Highlights',
      '- ',
      '',
      '## What’s New',
      '- ',
      '',
      '## Improvements',
      '- ',
      '',
      '## Fixes',
      '- ',
      '',
      '## Known Issues',
      '- ',
      '',
      '## Rollout',
      '- 灰度范围：',
      '- 回滚方案：',
    ].join('\n')
  }

  if (n === 'competitor' || n === 'compete') {
    return header + [
      '## 竞品概览',
      '- 产品名称：',
      '- 目标人群：',
      '- 定价：',
      '',
      '## 核心能力对比',
      '| 维度 | 竞品 | 我们 | 结论 |',
      '| --- | --- | --- | --- |',
      '| | | | |',
      '',
      '## 体验走查',
      '- 关键路径：',
      '- 亮点：',
      '- 痛点：',
      '',
      '## 机会点',
      '- 短期：',
      '- 中期：',
      '- 长期：',
    ].join('\n')
  }

  return null
}

// ── /template ─────────────────────────────────────────────────────────────────
const templateCommand: SlashCommand = {
  name: 'template',
  description: 'Templates: /template list | /template <name> [topic] | /template save <name> <file> [topic]',
  usage: '/template list | /template <name> [topic] | /template save <name> <file> [topic]',
  examples: [' /template prd 新功能名称', ' /template save prd ./PRD.md 新功能名称'],
  async execute(args, state, _setState) {
    const trimmed = args.trim()
    const [a, b, ...rest] = trimmed.split(/\s+/)
    const cmd = (a || 'list').toLowerCase()

    if (cmd === 'list') {
      return [
        'Templates:',
        '- prd [topic]',
        '- user-story|story [topic]',
        '- release-note|release [topic]',
        '- competitor [topic]',
        '',
        'Usage:',
        '  /template prd 新功能名称',
        '  /template save prd ./PRD.md 新功能名称',
      ].join('\n')
    }

    if (cmd === 'save') {
      const name = (b || '').trim()
      const file = (rest[0] || '').trim()
      const topic = rest.slice(1).join(' ')
      if (!name || !file) return 'Usage: /template save <name> <file> [topic]'
      const content = renderTemplate(name, topic)
      if (!content) return `Unknown template: ${name}. Use: /template list`
      const abs = resolve(state.cwd, file)
      await mkdir(dirname(abs), { recursive: true })
      await writeFile(abs, content, 'utf-8')
      return `Template saved: ${abs}`
    }

    const content = renderTemplate(cmd, [b, ...rest].join(' '))
    if (!content) return `Unknown template: ${cmd}. Use: /template list`
    return content
  },
}

// ── /align ────────────────────────────────────────────────────────────────────
const alignCommand: SlashCommand = {
  name: 'align',
  description: 'Ingest/scan files for PM alignment: /align scan|add|list|show|clear',
  usage: '/align scan|add|list|show|clear',
  examples: [' /align scan', ' /align add README.md docs/**/*.md product/**/*.md', ' /align list'],
  async execute(args, state, _setState) {
    const trimmed = args.trim()
    const [sub, ...rest] = trimmed.split(/\s+/)
    const cmd = (sub || 'list').toLowerCase()

    if (cmd === 'list') {
      const ctx = await loadPmContext(state.cwd)
      if (ctx.files.length === 0) return 'No ingested files. Use: /align scan or /align add <glob>'
      const lines = ctx.files.slice(0, 30).map((f, i) => `  ${i + 1}. ${f.path}  (${Math.round(f.size / 1024)}KB)`)
      const more = ctx.files.length > 30 ? `\n  … (${ctx.files.length - 30} more)` : ''
      return `Aligned files:\n${lines.join('\n')}${more}`
    }

    if (cmd === 'clear') {
      await clearPmContext(state.cwd)
      return 'Alignment context cleared.'
    }

    if (cmd === 'scan') {
      const patterns = [
        'README.md',
        'docs/**/*.{md,txt}',
        'product/**/*.{md,txt}',
        'design/**/*.{md,txt}',
        '*.{md,txt}',
      ]
      const res = await ingestPmFiles({ cwd: state.cwd, patternsOrPaths: patterns, maxFiles: 50 })
      return `Scan complete. added=${res.added} skipped=${res.skipped} total=${res.total}`
    }

    if (cmd === 'add') {
      if (rest.length === 0) return 'Usage: /align add <globOrPath> [more...]'
      const items = rest.flatMap(t => t.split(',')).map(s => s.trim()).filter(Boolean)
      const res = await ingestPmFiles({ cwd: state.cwd, patternsOrPaths: items, maxFiles: 100 })
      return `Ingest complete. added=${res.added} skipped=${res.skipped} total=${res.total}`
    }

    if (cmd === 'show') {
      const key = rest.join(' ').trim()
      if (!key) return 'Usage: /align show <number|path>'
      const ctx = await loadPmContext(state.cwd)
      let f = null as any
      if (/^\d+$/.test(key)) {
        const idx = Number(key)
        f = Number.isFinite(idx) ? ctx.files[idx - 1] : null
      } else {
        const k = key.replace(/\\/g, '/')
        f = ctx.files.find(x => x.path === k) ?? null
      }
      if (!f) return `Not found: ${key}`
      return `[FILE] ${f.path}\n\n${f.excerpt}`
    }

    return 'Usage: /align scan|add|list|show|clear'
  },
}

// ── /decision ─────────────────────────────────────────────────────────────────
const decisionCommand: SlashCommand = {
  name: 'decision',
  description: 'Decision ledger: /decision add|list|show|link|export',
  usage: '/decision add|list|show|link|export|extract',
  examples: [' /decision add 定价策略 :: 采用按席位计费', ' /decision list', ' /decision export ./DECISIONS.md', ' /decision extract'],
  async execute(args, state, setState) {
    const trimmed = args.trim()
    const [sub, ...rest] = trimmed.split(/\s+/)
    const cmd = (sub || 'list').toLowerCase()

    if (cmd === 'list') {
      const ledger = await loadDecisionLedger(state.cwd)
      return renderDecisionList(ledger, 30)
    }

    if (cmd === 'add') {
      const raw = rest.join(' ').trim()
      if (!raw) return 'Usage: /decision add <title> :: <summary>  (or :: {json})'
      const parts = raw.split('::')
      const title = (parts[0] ?? '').trim()
      const tail = (parts.slice(1).join('::') ?? '').trim()
      if (!title || !tail) return 'Usage: /decision add <title> :: <summary>  (or :: {json})'

      let payload: any = null
      if (tail.startsWith('{')) {
        try { payload = JSON.parse(tail) } catch { payload = null }
      }

      const summary = payload?.summary ? String(payload.summary) : tail
      const d = await addDecision(state.cwd, {
        title,
        summary,
        rationale: payload?.rationale ? String(payload.rationale) : undefined,
        owner: payload?.owner ? String(payload.owner) : undefined,
        due: payload?.due ? String(payload.due) : undefined,
        alternatives: Array.isArray(payload?.alternatives) ? payload.alternatives.map(String) : undefined,
        links: Array.isArray(payload?.links) ? payload.links.map(String) : undefined,
        source: { sessionId: state.sessionId },
      })
      return `Decision recorded: ${d.id.slice(0, 8)}  ${d.title}`
    }

    if (cmd === 'show') {
      const key = rest.join(' ').trim()
      if (!key) return 'Usage: /decision show <number|idPrefix>'
      const ledger = await loadDecisionLedger(state.cwd)
      const items = ledger.decisions.slice().sort((a, b) => b.updatedAt - a.updatedAt)
      let d = null as any
      if (/^\d+$/.test(key)) {
        const idx = Number(key)
        d = Number.isFinite(idx) ? items[idx - 1] : null
      } else {
        d = items.find(x => x.id.startsWith(key) || x.id.slice(0, 8) === key) ?? null
      }
      if (!d) return `Not found: ${key}`
      const lines = [
        `id: ${d.id}`,
        `title: ${d.title}`,
        d.owner ? `owner: ${d.owner}` : null,
        d.due ? `due: ${d.due}` : null,
        `updated: ${new Date(d.updatedAt).toLocaleString()}`,
        '',
        d.summary,
        d.rationale ? `\nRationale:\n${d.rationale}` : null,
        d.alternatives?.length ? `\nAlternatives:\n- ${d.alternatives.join('\n- ')}` : null,
        d.links?.length ? `\nLinks:\n- ${d.links.join('\n- ')}` : null,
      ].filter(Boolean) as string[]
      return lines.join('\n')
    }

    if (cmd === 'link') {
      const [id, ...rest2] = rest
      const link = rest2.join(' ').trim()
      if (!id || !link) return 'Usage: /decision link <idPrefix> <link>'
      const d = await linkDecision(state.cwd, id, link)
      if (!d) return `Not found: ${id}`
      return `Linked: ${d.id.slice(0, 8)}  (+1 link)`
    }

    if (cmd === 'export') {
      const file = rest.join(' ').trim() || './DECISIONS.md'
      const abs = await exportDecisionLedgerMarkdown(state.cwd, file)
      return `Decision ledger exported: ${abs}`
    }

    if (cmd === 'extract') {
      const ledger = await loadDecisionLedger(state.cwd)
      const ctx = await loadPmContext(state.cwd)
      const prompt = [
        'You are a PM assistant. Extract new or updated decisions from the conversation and the files.',
        'Return a concise list of decisions the team should record in a decision ledger.',
        '',
        'Format:',
        '- Provide a numbered list of decisions.',
        '- For each: Title, Summary, Rationale (optional), Owner (optional), Due (optional), Links (optional).',
        '',
        'Existing decisions:',
        renderDecisionForPrompt(ledger),
        '',
        'Aligned files:',
        renderPmContextForPrompt(ctx),
        '',
        'Conversation (most recent messages):',
        state.messages
          .filter(m => (m.role === 'user' || m.role === 'assistant') && !m.toolUseId)
          .slice(-30)
          .map(m => `${m.role.toUpperCase()}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`)
          .join('\n\n'),
      ].join('\n')
      setState(prev => ({ ...prev, pendingAutomatedPrompt: { label: 'Decision Extract', prompt } }))
      return 'Extracting decisions…'
    }

    return 'Usage: /decision add|list|show|link|export|extract'
  },
}

// ── /impact ───────────────────────────────────────────────────────────────────
const impactCommand: SlashCommand = {
  name: 'impact',
  description: 'Change impact analysis: /impact <change description>',
  usage: '/impact <change description>',
  examples: [' /impact 把「开关默认开」改成默认关，并增加灰度开关'],
  async execute(args, state, setState) {
    const change = args.trim()
    if (!change) return 'Usage: /impact <change description>'
    const ledger = await loadDecisionLedger(state.cwd)
    const ctx = await loadPmContext(state.cwd)
    const prompt = [
      'You are a senior product manager and delivery lead.',
      'Analyze the impact of the following change request.',
      'Use ONLY the provided aligned files and decision ledger as the source of truth; if information is missing, call it out as open questions.',
      '',
      `Change request:\n${change}`,
      '',
      'Decision ledger:',
      renderDecisionForPrompt(ledger),
      '',
      'Aligned files:',
      renderPmContextForPrompt(ctx),
      '',
      'Output (use headings):',
      '1) Summary (what changes, what doesn’t)',
      '2) Affected decisions (which decision IDs to revisit, if any)',
      '3) Affected documents (file path → suggested edits as bullet list)',
      '4) Acceptance criteria changes',
      '5) Analytics/metrics impact',
      '6) Risks & rollout considerations',
      '7) Open questions',
    ].join('\n')
    setState(prev => ({ ...prev, pendingAutomatedPrompt: { label: 'Change Impact', prompt } }))
    return 'Running change impact analysis…'
  },
}

// ── /pack ─────────────────────────────────────────────────────────────────────
const packCommand: SlashCommand = {
  name: 'pack',
  description: 'Alignment pack: /pack weekly | /pack feature <name>',
  usage: '/pack weekly | /pack feature <name>',
  examples: [' /pack weekly', ' /pack feature 新支付页'],
  async execute(args, state, setState) {
    const trimmed = args.trim()
    const [sub, ...rest] = trimmed.split(/\s+/)
    const cmd = (sub || '').toLowerCase()
    const title = rest.join(' ').trim()

    if (!cmd || (cmd === 'feature' && !title)) {
      return 'Usage: /pack weekly | /pack feature <name>'
    }

    const ledger = await loadDecisionLedger(state.cwd)
    const ctx = await loadPmContext(state.cwd)
    const kind = cmd === 'weekly' ? 'Weekly Alignment Pack' : `Feature Alignment Pack: ${title}`

    const prompt = [
      'You are a product lead preparing an alignment pack for cross-functional stakeholders.',
      'Use ONLY the provided aligned files and decision ledger; call out missing info explicitly.',
      '',
      `Pack type: ${kind}`,
      '',
      'Decision ledger:',
      renderDecisionForPrompt(ledger),
      '',
      'Aligned files:',
      renderPmContextForPrompt(ctx),
      '',
      'Output (Markdown):',
      '# TL;DR',
      '# Goals',
      '# Scope (In / Out)',
      '# Current Status',
      '# Key Decisions (with IDs)',
      '# Risks & Mitigations',
      '# Dependencies',
      '# Next Steps / Owners',
      '# Questions to Resolve',
    ].join('\n')

    setState(prev => ({ ...prev, pendingAutomatedPrompt: { label: kind, prompt } }))
    return 'Generating alignment pack…'
  },
}

// ── /session ──────────────────────────────────────────────────────────────────
const sessionCommand: SlashCommand = {
  name: 'session',
  description: 'Session tools: /session new|rename|export',
  usage: '/session new [title] | /session rename <title> | /session export [file]',
  examples: [' /session new 需求评审', ' /session rename 增长实验 A', ' /session export ./session.md'],
  async execute(args, state, setState) {
    const trimmed = args.trim()
    const [sub, ...rest] = trimmed.split(/\s+/)
    const cmd = (sub || '').toLowerCase()

    if (cmd === 'new') {
      const title = rest.join(' ').trim() || undefined
      const now = Date.now()
      setState(prev => ({
        ...prev,
        sessionId: randomUUID(),
        sessionCreatedAt: now,
        sessionTitle: title,
        messages: [],
        inputTokens: 0,
        outputTokens: 0,
        planApproved: false,
        pendingPlan: undefined,
        error: null,
      }))
      return title ? `New session created: ${title}` : 'New session created.'
    }

    if (cmd === 'rename') {
      const title = rest.join(' ').trim()
      if (!title) return 'Usage: /session rename <title>'
      setState(prev => ({ ...prev, sessionTitle: title }))
      await saveSession({
        id: state.sessionId,
        title,
        createdAt: state.sessionCreatedAt,
        updatedAt: Date.now(),
        cwd: state.cwd,
        model: state.model,
        messages: state.messages,
        inputTokens: state.inputTokens,
        outputTokens: state.outputTokens,
      })
      return `Session renamed: ${title}`
    }

    if (cmd === 'export') {
      const file = rest.join(' ').trim() || `./guang-session-${state.sessionId.slice(0, 8)}.md`
      const abs = resolve(state.cwd, file)
      await mkdir(dirname(abs), { recursive: true })
      const header = [
        `# ${state.sessionTitle ?? 'Guang Code Session'}`,
        '',
        `- Session: ${state.sessionId}`,
        `- Updated: ${new Date().toISOString()}`,
        `- CWD: ${state.cwd}`,
        `- Model: ${state.model}`,
        '',
        '---',
        '',
      ].join('\n')

      const body = state.messages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .filter(m => !m.toolUseId)
        .map(m => {
          const label = m.role === 'user' ? 'User' : 'Assistant'
          const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
          return `## ${label}\n\n${text}\n`
        })
        .join('\n')

      await writeFile(abs, header + body, 'utf-8')
      return `Session exported: ${abs}`
    }

    return 'Usage: /session new [title] | /session rename <title> | /session export [file]'
  },
}

// ── /trust ────────────────────────────────────────────────────────────────────
const trustCommand: SlashCommand = {
  name: 'trust',
  description: 'Manage project trust: /trust list | /trust revoke <mcp|hooks> [cwd]',
  usage: '/trust list | /trust revoke <mcp|hooks> [cwd]',
  examples: [' /trust list', ' /trust revoke mcp', ' /trust revoke hooks ../other-project'],
  async execute(args, state, _setState) {
    const trimmed = args.trim()
    const [sub, kindRaw, ...rest] = trimmed.split(/\s+/)
    const cmd = (sub || 'list').toLowerCase()

    if (cmd === 'list') {
      const cfg = await loadConfig()
      const tp = cfg.trustedProjects ?? {}
      const keys = Object.keys(tp)
      if (keys.length === 0) return 'No trusted projects.'
      const lines = keys.slice(0, 50).map(k => {
        const v: any = tp[k]
        const m = v?.mcp?.hash ? String(v.mcp.hash).slice(0, 16) : ''
        const h = v?.hooks?.hash ? String(v.hooks.hash).slice(0, 16) : ''
        const parts = [
          m ? `mcp:${m}` : null,
          h ? `hooks:${h}` : null,
        ].filter(Boolean)
        return `- ${k}  ${parts.join('  ')}`
      })
      return `Trusted projects:\n${lines.join('\n')}`
    }

    if (cmd === 'revoke') {
      const kind = (kindRaw || '').toLowerCase()
      if (kind !== 'mcp' && kind !== 'hooks') return 'Usage: /trust revoke <mcp|hooks> [cwd]'
      const cwd = rest.join(' ').trim() || state.cwd
      await setTrustedProjectConfig({ cwd, kind: kind as any, hash: null })
      return `Revoked trust: ${kind} (${cwd})`
    }

    return 'Usage: /trust list | /trust revoke <mcp|hooks> [cwd]'
  },
}

// ── /exit ─────────────────────────────────────────────────────────────────────
const exitCommand: SlashCommand = {
  name: 'exit',
  description: 'Exit Guang Code',
  usage: '/exit',
  noArgs: true,
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

const skillsCommand: SlashCommand = {
  name: 'skills',
  description: 'List available skills from ~/.guang-code/skills and .guang/skills',
  usage: '/skills',
  noArgs: true,
  async execute(_args, state, _setState) {
    const skills = loadAllSkills(state.cwd)
    if (skills.length === 0) {
      return [
        'No skills found.',
        '',
        'Directories:',
        `  - ${state.cwd}\\.guang\\skills\\<skill>\\SKILL.md`,
        `  - ${homedir()}\\.guang-code\\skills\\<skill>\\SKILL.md`,
      ].join('\n')
    }

    const lines = skills.map(s => `- ${s.id}  ${s.description}`)
    return ['Skills:', ...lines, '', 'Run: /skill <id> [args]'].join('\n')
  },
}

const skillCommand: SlashCommand = {
  name: 'skill',
  description: 'Execute a skill: /skill <id> [args]',
  async execute(args, state, _setState) {
    const trimmed = args.trim()
    if (!trimmed) return 'Usage: /skill <id> [args]'
    const [id, ...rest] = trimmed.split(' ')
    const skillArgs = rest.join(' ')
    const skills = loadAllSkills(state.cwd)
    const skill = skills.find(s => s.id === id)
    if (!skill) return `Skill not found: ${id}`
    return renderSkillInvocation(skill, skillArgs)
  },
}

const memoryCommand: SlashCommand = {
  name: 'memory',
  description: 'Manage persistent project memory',
  async execute(args, state, setState) {
    const trimmed = args.trim()
    const [sub, ...rest] = trimmed.split(/\s+/)
    const cmd = (sub || 'list').toLowerCase()
    const cfg = await loadConfig()
    const baseDir = cfg.memoryDirectory

    if (cmd === 'enable' || cmd === 'disable') {
      await setMemoryEnabled(cmd === 'enable')
      const updated = await loadConfig()
      setState(prev => ({ ...prev, providerConfig: updated }))
      return `Memory ${cmd === 'enable' ? 'enabled' : 'disabled'}.`
    }

    if (cmd === 'dir') {
      const next = rest.join(' ').trim()
      if (!next) {
        const cur = (cfg.memoryDirectory && cfg.memoryDirectory.trim()) ? cfg.memoryDirectory.trim() : '(default)'
        return `Memory base directory: ${cur}`
      }
      await setMemoryDirectory(next)
      const updated = await loadConfig()
      setState(prev => ({ ...prev, providerConfig: updated }))
      return `Memory base directory set to: ${next}`
    }

    if (cmd === 'path') {
      return `Project memory dir:\n${getProjectMemoryDir(state.cwd, { baseDir })}`
    }

    if (cmd === 'init') {
      const created = ensureMemoryIndexExists(state.cwd, { baseDir })
      return `Memory initialized:\n${created.entrypoint}`
    }

    if (cmd === 'list') {
      const entries = listMemoryEntries(state.cwd, { baseDir })
      if (entries.length === 0) {
        return [
          'No memory entries found.',
          '',
          'Usage:',
          '  /memory add [user|project|reference|feedback] :: <markdown>',
          '  /memory show <id>',
          '  /memory remove <id>',
          '  /memory path',
          '  /memory init',
          '  /memory enable|disable',
          '  /memory dir [path]',
        ].join('\n')
      }
      const lines = entries.slice(0, 50).map(e => `- ${e.id}  ${e.name}${e.description ? ` — ${e.description}` : ''}`)
      return ['Memory entries:', ...lines, '', 'Usage: /memory add [type] :: <markdown>'].join('\n')
    }

    if (cmd === 'add') {
      const restText = rest.join(' ').trim()
      const sep = restText.indexOf('::')
      if (sep < 0) return 'Usage: /memory add [user|project|reference|feedback] :: <markdown>'
      const header = restText.slice(0, sep).trim()
      const body = restText.slice(sep + 2).trim()
      if (!body) return 'Usage: /memory add :: <markdown>'
      const type = (header === 'user' || header === 'project' || header === 'reference' || header === 'feedback')
        ? (header as any)
        : 'project'
      const entry = addMemory(state.cwd, { type, body, baseDir })
      return `Memory saved: ${entry.id}`
    }

    if (cmd === 'show') {
      const id = rest[0]
      if (!id) return 'Usage: /memory show <id>'
      const content = readMemoryFile(state.cwd, id, { baseDir })
      if (!content) return `Memory not found: ${id}`
      return content
    }

    if (cmd === 'remove') {
      const id = rest[0]
      if (!id) return 'Usage: /memory remove <id>'
      const res = removeMemory(state.cwd, id, { baseDir })
      if (!res.ok) return res.error ?? 'Remove failed'
      return `Removed memory: ${id}`
    }

    return 'Usage: /memory list|add|show|remove|path|init|enable|disable|dir'
  },
}

const cronCommand: SlashCommand = {
  name: 'cron',
  description: 'Manage scheduled tasks in .guang/scheduled_tasks.json',
  async execute(args, state, _setState) {
    const trimmed = args.trim()
    const [sub, ...rest] = trimmed.split(/\s+/)
    const cmd = (sub || 'list').toLowerCase()

    if (cmd === 'list') {
      const tasks = listProjectCronTasks(state.cwd)
      if (tasks.length === 0) {
        return [
          'No scheduled tasks configured.',
          '',
          'Usage:',
          '  /cron add <cron expr> :: <prompt>',
          '  /cron add-once <cron expr> :: <prompt>',
          '  /cron enable <id>',
          '  /cron disable <id>',
          '  /cron run <id>',
          '  /cron remove <id>',
          '  /cron clear',
          '',
          'Cron expr: "min hour dom month dow" (supports *, ranges, lists, */step)',
          'Example: */5 * * * *',
        ].join('\n')
      }

      const lines = tasks.map(t => {
        const flags = [
          t.enabled === false ? 'disabled' : null,
          t.recurring === false ? 'once' : 'recurring',
        ].filter(Boolean).join(', ')
        return `- ${t.id}  ${t.cron}  (${flags})\n  ${t.prompt.replace(/\n+/g, ' ').slice(0, 160)}`
      })
      return ['Scheduled tasks:', ...lines].join('\n')
    }

    if (cmd === 'clear') {
      clearProjectCronTasks(state.cwd)
      return 'Scheduled tasks cleared.'
    }

    if (cmd === 'remove') {
      const id = rest[0]
      if (!id) return 'Usage: /cron remove <id>'
      const res = removeProjectCronTask(state.cwd, id)
      if (!res.ok) return res.error ?? 'Remove failed'
      return `Removed task: ${id}`
    }

    if (cmd === 'enable' || cmd === 'disable') {
      const id = rest[0]
      if (!id) return `Usage: /cron ${cmd} <id>`
      const res = setProjectCronTaskEnabled(state.cwd, id, cmd === 'enable')
      if (!res.ok) return res.error ?? 'Update failed'
      return `${cmd === 'enable' ? 'Enabled' : 'Disabled'} task: ${id}`
    }

    if (cmd === 'run') {
      const id = rest[0]
      if (!id) return 'Usage: /cron run <id>'
      const tasks = listProjectCronTasks(state.cwd)
      const task = tasks.find(t => t.id === id)
      if (!task) return `Task not found: ${id}`
      return `[Scheduled Task: ${id}]\n${task.prompt}`
    }

    if (cmd === 'add' || cmd === 'add-once') {
      const raw = rest.join(' ').trim()
      const sep = raw.indexOf('::')
      if (sep < 0) return 'Usage: /cron add <cron expr> :: <prompt>'
      const cronExpr = raw.slice(0, sep).trim()
      const prompt = raw.slice(sep + 2).trim()
      if (!cronExpr || !prompt) return 'Usage: /cron add <cron expr> :: <prompt>'

      if (!parseCronExpression(cronExpr)) {
        return `Invalid cron expression: ${cronExpr}`
      }

      const task = addProjectCronTask(state.cwd, {
        cron: cronExpr,
        prompt,
        recurring: cmd !== 'add-once',
        enabled: true,
      })
      return `Scheduled task created: ${task.id}`
    }

    return 'Usage: /cron list|add|add-once|remove|enable|disable|run|clear'
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
  planCommand,
  styleCommand,
  permissionsCommand,
  skillsCommand,
  skillCommand,
  memoryCommand,
  cronCommand,
  compactCommand,
  alignCommand,
  decisionCommand,
  impactCommand,
  packCommand,
  sessionsCommand,
  resumeCommand,
  sessionCommand,
  templateCommand,
  trustCommand,
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
