// ============================================================
//  Guang Code — QueryEngine (Provider-agnostic)
//  Works with any LLMProvider: Anthropic, OpenAI, MiniMax, etc.
// ============================================================

import { randomUUID } from 'crypto'
import type {
  SessionMessage,
  ToolDef,
  ToolContext,
  PermissionMode,
  GcConfig,
  OnStreamChunk,
  LLMProvider,
  ChatMessage,
  ProviderTool,
  ToolCall,
} from '../types/index.js'
import { getTools, getToolByName } from '../tools/index.js'
import { createProvider } from '../providers/index.js'
import { loadProjectInstructions } from './projectInstructions.js'
import { mcpManager } from './mcpClient.js'
import { createMcpTools } from '../tools/McpTool.js'
import { hooksManager } from './hooks/index.js'
import { loadConfig, addAlwaysAllowRule } from './config.js'
import { runSubagentSession } from './subagentRun.js'
import { getOutputStylePrompt } from './outputStyle.js'
import { decidePermission, loadProjectPermissionRules } from './permissions.js'
import { loadMemoryForPrompt } from './memdir.js'
import { redactIfSecrets } from './secretScanner.js'
import { parseTokenBudget } from './tokenBudget.js'
import { createBudgetTracker, checkTokenBudget } from './tokenBudgetTracker.js'

// ── System Prompt ──────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are Guang Code, a powerful AI coding assistant running in the terminal. You help users with software engineering tasks including:

- Writing, reading, editing, and refactoring code
- Running shell commands and tests
- Searching codebases with grep and glob
- Debugging errors and explaining code
- Managing files and directories
- Fetching documentation from the web

## How you work
1. When you need to take an action (read a file, run a command, write code), use the available tools
2. Always think step by step. Read relevant files before editing them
3. For complex tasks, break them down and tackle one step at a time
4. Explain what you're doing as you work
5. After completing a task, summarize what was done

## Tool guidelines
- Use Read before Edit — always read a file before modifying it
- Prefer Edit over Write for small changes to existing files  
- Use LS to understand project structure before diving into files
- Use Grep to find where things are defined or used
- Use Task to delegate focused research or sub-tasks to a sub-agent
- When running Bash commands, prefer short, safe commands and explain what they do

## Style
- Be concise but informative
- Use code blocks for code snippets
- Don't repeat yourself unnecessarily
- When you encounter errors, analyze them and try to fix them

{{OUTPUT_STYLE}}

Current working directory: {{CWD}}

{{PROJECT_INSTRUCTIONS}}

{{MEMORY}}
`

export type QueryOptions = {
  messages: SessionMessage[]
  model: string
  cwd: string
  permissionMode: PermissionMode
  providerConfig: GcConfig
  /** Optional API key override (from --api-key CLI flag) */
  apiKeyOverride?: string
  onPermissionRequest: (toolName: string, description: string) => Promise<boolean | 'always_allow' | 'allow_once' | 'deny'>
  onStreamChunk: OnStreamChunk
  signal?: AbortSignal
}

const MAX_TOOL_ITERATIONS = 20
const AUTO_COMPACT_CHAR_THRESHOLD = 60000
const AUTO_COMPACT_TAIL_MESSAGES = 8
const AUTO_COMPACT_MAX_FAILURES = 3

export async function runQuery(options: QueryOptions): Promise<{
  messages: SessionMessage[]
  inputTokens: number
  outputTokens: number
}> {
  const {
    messages,
    model,
    cwd,
    permissionMode,
    providerConfig,
    apiKeyOverride,
    onPermissionRequest,
    onStreamChunk,
    signal,
  } = options

  // Create the right provider for this model
  let provider: LLMProvider
  try {
    provider = createProvider(model, providerConfig, apiKeyOverride)
  } catch (err: unknown) {
    const e = err as Error
    onStreamChunk({ type: 'error', error: e.message })
    return { messages: [], inputTokens: 0, outputTokens: 0 }
  }

  const config = await loadConfig()
  const alwaysAllowRules = config.alwaysAllowRules || []
  const permissionRules = [
    ...(config.permissionRules || []),
    ...loadProjectPermissionRules(cwd),
  ]
  const outputStyle = getOutputStylePrompt(config.outputStyle)

  const tools = getTools()
  let activeTool: { name: string; input: Record<string, unknown> } | null = null
  const toolContext: ToolContext = {
    cwd,
    permissionMode,
    model,
    providerConfig,
    apiKeyOverride,
    onPermissionRequest: async (toolName: string, description: string) => {
      // 1. Check if tool is in alwaysAllowRules
      if (alwaysAllowRules.includes(toolName)) {
        return true
      }

      const decision = decidePermission({
        permissionMode,
        rules: permissionRules,
        toolName,
        toolInput: activeTool && activeTool.name === toolName ? activeTool.input : undefined,
        cwd,
      })
      if (decision === 'allow') return true
      if (decision === 'deny') return false

      const approved = await onPermissionRequest(toolName, description)
      if (approved === 'always_allow') {
        await addAlwaysAllowRule(toolName)
        return true
      }
      if (approved === 'allow_once') {
        return true
      }
      return false
    }
  }

  // Load MCP tools dynamically
  await mcpManager.initializeAll(cwd)
  const mcpClients = mcpManager.getClients()
  for (const [serverName, client] of mcpClients.entries()) {
    try {
      const mcpTools = await createMcpTools(client, serverName)
      tools.push(...mcpTools)
    } catch (err) {
      console.error(`Error loading tools from MCP server ${serverName}:`, err)
    }
  }

  const providerTools: ProviderTool[] = tools.map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }))

  const projectInstructions = loadProjectInstructions(cwd)
  let instructionsText = ''
  if (projectInstructions) {
    instructionsText = `\n## Project Instructions\nThe following instructions have been provided by the user for this specific project. You must strictly adhere to these rules:\n\n<project_instructions>\n${projectInstructions}\n</project_instructions>\n`
  }

  const memory = loadMemoryForPrompt(cwd, { enabled: config.memoryEnabled, baseDir: config.memoryDirectory })
  const memoryText = memory
    ? `\n<memory>\n${memory.text}\n</memory>\n`
    : ''

  const systemPrompt = SYSTEM_PROMPT
    .replace('{{CWD}}', cwd)
    .replace('{{PROJECT_INSTRUCTIONS}}', instructionsText)
    .replace('{{OUTPUT_STYLE}}', outputStyle.prompt)
    .replace('{{MEMORY}}', memoryText)

  // Initialize Hooks
  await hooksManager.loadHooks(cwd)
  await hooksManager.triggerEvent('SessionStart', cwd, { model })

  // Build conversation history in provider-agnostic format
  let chatHistory: ChatMessage[] = sessionMessagesToChatMessages(messages)

  const lastUserText = findLastUserText(chatHistory) ?? ''
  const budget = parseTokenBudget(lastUserText)
  const budgetTracker = createBudgetTracker()

  const autoDelegateEnabled = Boolean(config.autoDelegate) || process.env.GC_AUTO_DELEGATE === '1'
  if (autoDelegateEnabled) {
    const injected = await autoDelegateIfNeeded({
      provider,
      model,
      chatHistory,
      cwd,
      providerConfig,
      apiKeyOverride,
    })
    if (injected) {
      chatHistory.push({ role: 'user', content: injected })
    }
  }

  let totalInput = 0
  let totalOutput = 0
  const newMessages: SessionMessage[] = []
  let iterations = 0
  let autoCompactFailures = 0

  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++

    if (signal?.aborted) break

    if (autoCompactFailures < AUTO_COMPACT_MAX_FAILURES) {
      const size = estimateChatHistorySize(chatHistory)
      if (size > AUTO_COMPACT_CHAR_THRESHOLD) {
        try {
          const { summary, postCompactHistory, droppedCount } = await autoCompactChatHistory({
            provider,
            model,
            chatHistory,
          })
          if (summary && postCompactHistory.length > 0) {
            chatHistory = postCompactHistory
            newMessages.push({
              id: randomUUID(),
              role: 'system',
              content: `[Conversation compacted: ${droppedCount} earlier messages summarized]`,
              timestamp: Date.now(),
            })
          }
        } catch (err: unknown) {
          autoCompactFailures++
        }
      }
    }

    let fullText = ''
    const pendingToolCalls: Map<string, ToolCall & { argsRaw: string }> = new Map()
    let finalStopReason = 'end_turn'
    let hasToolCalls = false

    try {
      const toolsForProvider = filterProviderToolsByAllowedTools(chatHistory, providerTools)
      for await (const chunk of provider.streamChat({
        model,
        system: systemPrompt,
        messages: chatHistory,
        tools: toolsForProvider,
        signal,
      })) {
        if (signal?.aborted) break

        switch (chunk.type) {
          case 'text_delta':
            fullText += chunk.text
            onStreamChunk({ type: 'text_delta', text: chunk.text })
            break

          case 'tool_call_start':
            pendingToolCalls.set(chunk.id, { id: chunk.id, name: chunk.name, input: {}, argsRaw: '' })
            onStreamChunk({ type: 'tool_start', toolName: chunk.name })
            break

          case 'tool_call_delta': {
            const tc = pendingToolCalls.get(chunk.id)
            if (tc) tc.argsRaw += chunk.partialJson
            break
          }

          case 'tool_call_end': {
            const tc = pendingToolCalls.get(chunk.toolCall.id)
            if (tc) {
              tc.input = chunk.toolCall.input
              hasToolCalls = true
            }
            break
          }

          case 'done':
            // A single stream may emit multiple 'done' chunks:
            // one for input tokens (from message_start) and one for output tokens
            if (chunk.stopReason !== '_input_tokens') {
              finalStopReason = chunk.stopReason
            }
            totalInput += chunk.inputTokens
            totalOutput += chunk.outputTokens
            break

          case 'error':
            onStreamChunk({ type: 'error', error: chunk.message })
            return { messages: newMessages, inputTokens: totalInput, outputTokens: totalOutput }
        }
      }
    } catch (err: unknown) {
      const e = err as Error
      if (e.name !== 'AbortError') {
        onStreamChunk({ type: 'error', error: e.message })
      }
      break
    }

    // Collect finalized tool calls
    const toolCallList = Array.from(pendingToolCalls.values())
      .filter(tc => tc.input && Object.keys(tc.input).length > 0 || tc.argsRaw)
      .map(tc => {
        if (Object.keys(tc.input).length === 0 && tc.argsRaw) {
          try { tc.input = JSON.parse(tc.argsRaw) } catch { /* */ }
        }
        return { id: tc.id, name: tc.name, input: tc.input }
      })

    // Build assistant message for history
    if (fullText || toolCallList.length > 0) {
      const assistantContent: Array<{ type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }> = []
      if (fullText) {
        assistantContent.push({ type: 'text', text: fullText })
      }
      for (const tc of toolCallList) {
        assistantContent.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input })
      }
      chatHistory.push({ role: 'assistant', content: assistantContent })

      if (fullText) {
        newMessages.push({
          id: randomUUID(),
          role: 'assistant',
          content: fullText,
          timestamp: Date.now(),
        })
      }
    }

    // No tool calls → check budget or done
    if (toolCallList.length === 0) {
      const decision = checkTokenBudget(
        budgetTracker,
        undefined, // agentId not currently used in this context
        budget,
        totalOutput
      )

      if (decision.action === 'continue') {
        chatHistory.push({ role: 'user', content: decision.nudgeMessage })
        newMessages.push({
          id: randomUUID(),
          role: 'user',
          content: decision.nudgeMessage,
          timestamp: Date.now(),
        })
        onStreamChunk({ type: 'tool_start', toolName: '…' })
        continue
      }
      break
    }

    // ── Execute tool calls ─────────────────────────────────────
    const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }> = []

    for (const tc of toolCallList) {
      // Find tool in dynamically aggregated tools array, not just getToolByName
      const toolDef = tools.find(t => t.name === tc.name) || getToolByName(tc.name)
      if (!toolDef) {
        toolResults.push({ type: 'tool_result', tool_use_id: tc.id, content: `Tool "${tc.name}" not found`, is_error: true })
        continue
      }

      try {
        activeTool = { name: tc.name, input: tc.input }

        const desc = buildPermissionDescription({ toolName: tc.name, input: tc.input, cwd })
        const allowed = await toolContext.onPermissionRequest(tc.name, desc)
        if (allowed !== true) {
          toolResults.push({ type: 'tool_result', tool_use_id: tc.id, content: `Permission denied for tool "${tc.name}".`, is_error: true })
          activeTool = null
          continue
        }

        await hooksManager.triggerEvent('PreToolUse', cwd, { tool_name: tc.name, tool_input: tc.input })
        const result = await toolDef.execute(tc.input, toolContext)
        await hooksManager.triggerEvent('PostToolUse', cwd, { tool_name: tc.name, tool_input: tc.input, result: result.content })
        activeTool = null
        
        const redacted = redactIfSecrets(result.content)
        const safeResultContent = redacted.redacted

        onStreamChunk({
          type: 'tool_done',
          toolName: tc.name,
          toolResult: result.isError ? `Error: ${safeResultContent}` : safeResultContent,
        })
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tc.id,
          content: safeResultContent,
          is_error: result.isError,
        })

        newMessages.push({
          id: randomUUID(), role: 'assistant',
          content: `[Tool: ${tc.name}]\nInput: ${JSON.stringify(sanitizeToolInputForHistory(tc.name, tc.input), null, 2)}`,
          timestamp: Date.now(), toolUseId: tc.id,
        })
        newMessages.push({
          id: randomUUID(), role: 'user',
          content: `[Tool Result: ${tc.name}]\n${safeResultContent}`,
          timestamp: Date.now(), toolUseId: tc.id,
        })
      } catch (err: unknown) {
        activeTool = null
        const e = err as Error
        toolResults.push({ type: 'tool_result', tool_use_id: tc.id, content: `Tool error: ${e.message}`, is_error: true })
      }
    }

    // Feed results back into history
    chatHistory.push({ role: 'user', content: toolResults })

    onStreamChunk({ type: 'tool_start', toolName: '…' }) // re-enter spinner
  }

  onStreamChunk({ type: 'done', inputTokens: totalInput, outputTokens: totalOutput })
  await hooksManager.triggerEvent('SessionEnd', cwd, { totalInput, totalOutput })
  return { messages: newMessages, inputTokens: totalInput, outputTokens: totalOutput }
}

// ── Helpers ────────────────────────────────────────────────────────

function filterProviderToolsByAllowedTools(history: ChatMessage[], tools: ProviderTool[]): ProviderTool[] {
  const lastUser = findLastUserText(history)
  if (!lastUser) return tools

  const m = lastUser.match(/^\s*Allowed tools:\s*(.+)\s*$/im)
  if (!m) return tools
  const raw = (m[1] ?? '').trim()
  if (!raw) return tools
  if (raw === '*' || raw.toLowerCase() === 'all') return tools

  const allow = new Set(raw.split(',').map(s => s.trim()).filter(Boolean).map(s => s.toLowerCase()))
  if (allow.size === 0) return tools

  return tools.filter(t => allow.has(t.name.toLowerCase()))
}

function sessionMessagesToChatMessages(messages: SessionMessage[]): ChatMessage[] {
  const result: ChatMessage[] = []

  for (const msg of messages) {
    if (msg.toolUseId) continue  // already embedded in history via chatHistory
    if (msg.role === 'system') continue

    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
    if (!content.trim()) continue

    const last = result[result.length - 1]
    if (last && last.role === msg.role && typeof last.content === 'string') {
      last.content = last.content + '\n' + content
    } else {
      result.push({ role: msg.role as 'user' | 'assistant', content })
    }
  }

  return result
}

function buildPermissionDescription(opts: { toolName: string; input: Record<string, unknown>; cwd: string }): string {
  const n = opts.toolName
  const i = opts.input ?? {}
  if (n === 'Read') {
    const fp = String(i.file_path ?? '')
    const a = i.start_line !== undefined ? Number(i.start_line) : 1
    const b = i.end_line !== undefined ? Number(i.end_line) : undefined
    const range = b ? `Lines ${a}-${b}` : `From line ${a}`
    return `Read file: ${fp}\n${range}\nCWD: ${opts.cwd}`
  }
  if (n === 'Write') {
    const fp = String(i.file_path ?? '')
    const c = String(i.content ?? '')
    const lines = c ? c.split('\n').length : 0
    return `Write file: ${fp}\nContent: ${lines} line(s)\nCWD: ${opts.cwd}`
  }
  if (n === 'Edit') {
    const fp = String(i.file_path ?? '')
    const oldS = String(i.old_string ?? '')
    const newS = String(i.new_string ?? '')
    return `Edit file: ${fp}\nReplace: ${oldS.split('\n').length} lines -> ${newS.split('\n').length} lines\nCWD: ${opts.cwd}`
  }
  if (n === 'LS') {
    const p = String(i.path ?? '.')
    return `List directory: ${p}\nCWD: ${opts.cwd}`
  }
  if (n === 'Grep') {
    const patt = String(i.pattern ?? '')
    const inc = i.include ? `\nInclude: ${String(i.include)}` : ''
    const p = i.path ? `\nPath: ${String(i.path)}` : ''
    return `Search pattern: ${patt}${inc}${p}\nCWD: ${opts.cwd}`
  }
  if (n === 'Glob') {
    const patt = String(i.pattern ?? '')
    const ign = i.ignore ? `\nIgnore: ${String(i.ignore)}` : ''
    return `Glob pattern: ${patt}${ign}\nCWD: ${opts.cwd}`
  }
  if (n === 'Bash') {
    const cmd = String(i.command ?? '')
    const red = redactIfSecrets(cmd)
    const shown = red.redacted.length > 240 ? red.redacted.slice(0, 240) + '…' : red.redacted
    return `Run command:\n${shown}\nCWD: ${opts.cwd}`
  }
  if (n === 'WebFetch') {
    const url = String(i.url ?? '')
    const red = redactIfSecrets(url)
    return `Fetch URL: ${red.redacted}\nCWD: ${opts.cwd}`
  }
  if (n === 'Task') {
    const q = String(i.query ?? '')
    const red = redactIfSecrets(q)
    return `Run sub-agent task:\n${red.redacted}\nCWD: ${opts.cwd}`
  }
  return `${n}\nCWD: ${opts.cwd}`
}

function sanitizeToolInputForHistory(toolName: string, input: Record<string, unknown>): Record<string, unknown> {
  const i = { ...(input ?? {}) }
  if (toolName === 'Write') {
    const c = String(i.content ?? '')
    i.content = `[omitted: ${c.length} chars]`
  }
  if (toolName === 'Edit') {
    const oldS = String(i.old_string ?? '')
    const newS = String(i.new_string ?? '')
    i.old_string = `[omitted: ${oldS.length} chars]`
    i.new_string = `[omitted: ${newS.length} chars]`
  }
  if (toolName === 'Bash') {
    const cmd = String(i.command ?? '')
    const red = redactIfSecrets(cmd)
    i.command = red.redacted
  }
  if (toolName === 'WebFetch') {
    const url = String(i.url ?? '')
    const red = redactIfSecrets(url)
    i.url = red.redacted
  }
  return i
}

function estimateChatHistorySize(history: ChatMessage[]): number {
  let total = 0
  for (const m of history) {
    if (m.role === 'system') continue
    if (typeof m.content === 'string') {
      total += m.content.length
      continue
    }
    if (Array.isArray(m.content)) {
      for (const part of m.content as Array<any>) {
        if (typeof part?.content === 'string') total += part.content.length
        if (typeof part?.text === 'string') total += part.text.length
        if (typeof part?.tool_use_id === 'string') total += part.tool_use_id.length
      }
    }
  }
  return total
}

async function autoCompactChatHistory(opts: {
  provider: LLMProvider
  model: string
  chatHistory: ChatMessage[]
}): Promise<{ summary: string; postCompactHistory: ChatMessage[]; droppedCount: number }> {
  const tail = opts.chatHistory.slice(-AUTO_COMPACT_TAIL_MESSAGES)
  const head = opts.chatHistory.slice(0, Math.max(0, opts.chatHistory.length - tail.length))

  const text = serializeChatHistoryForSummary(head)
  const summary = await summarizeText(opts.provider, opts.model, text)

  const postCompactHistory: ChatMessage[] = [
    {
      role: 'user',
      content: `[Conversation summary]\n${summary}\n[/Conversation summary]`,
    },
    ...tail,
  ]

  return {
    summary,
    postCompactHistory,
    droppedCount: head.length,
  }
}

function serializeChatHistoryForSummary(history: ChatMessage[]): string {
  const lines: string[] = []

  for (const m of history) {
    if (m.role === 'system') continue
    if (typeof m.content === 'string') {
      lines.push(`${m.role.toUpperCase()}:\n${m.content}`)
      continue
    }
    if (m.role === 'assistant') {
      const parts = m.content as Array<any>
      const text = parts.filter(p => p.type === 'text').map(p => p.text ?? '').join('')
      const toolUses = parts.filter(p => p.type === 'tool_use').map(p => `${p.name}(${JSON.stringify(p.input ?? {})})`).join('\n')
      if (text.trim()) lines.push(`ASSISTANT:\n${text}`)
      if (toolUses.trim()) lines.push(`ASSISTANT TOOLS:\n${toolUses}`)
      continue
    }
    if (m.role === 'user') {
      const parts = m.content as Array<any>
      const toolResults = parts.map(p => `${p.tool_use_id}: ${p.is_error ? 'Error: ' : ''}${p.content}`).join('\n')
      lines.push(`TOOL RESULTS:\n${toolResults}`)
      continue
    }
  }

  const joined = lines.join('\n\n')
  if (joined.length <= AUTO_COMPACT_CHAR_THRESHOLD) return joined

  const head = joined.slice(0, Math.min(20000, joined.length))
  const tail = joined.slice(Math.max(0, joined.length - 20000))
  const keyRefs = buildKeyReferences(joined, 15000)

  const combined =
    `[KEY REFERENCES]\n${keyRefs}\n[/KEY REFERENCES]\n\n` +
    `[EARLY CONTEXT SNIPPET]\n${head}\n[/EARLY CONTEXT SNIPPET]\n\n` +
    `[LATE CONTEXT SNIPPET]\n${tail}\n[/LATE CONTEXT SNIPPET]`

  if (combined.length <= AUTO_COMPACT_CHAR_THRESHOLD) return combined
  return combined.slice(0, AUTO_COMPACT_CHAR_THRESHOLD)
}

function buildKeyReferences(text: string, maxChars: number): string {
  const fileRefs = extractFileReferences(text, 80)
  const commands = extractCommandLikeLines(text, 60)
  const signals = extractSignalLines(text, 80)

  const parts: string[] = []
  if (fileRefs.length > 0) {
    parts.push('Files:\n' + fileRefs.map(s => `- ${s}`).join('\n'))
  }
  if (commands.length > 0) {
    parts.push('Commands:\n' + commands.map(s => `- ${s}`).join('\n'))
  }
  if (signals.length > 0) {
    parts.push('Signals:\n' + signals.map(s => `- ${s}`).join('\n'))
  }

  const out = parts.join('\n\n').trim()
  if (out.length <= maxChars) return out
  return out.slice(0, maxChars)
}

function extractFileReferences(text: string, limit: number): string[] {
  const out: string[] = []
  const seen = new Set<string>()

  const patterns: RegExp[] = [
    /file:\/\/\/[^\s)>"'`]+/gi,
    /[a-zA-Z]:\\[^\s)>"'`]+/g,
    /\/[^\s)>"'`]+\.(ts|tsx|js|jsx|json|md|yml|yaml|toml|txt|css|scss|py|go|rs|java|kt|cs|sh|ps1|bat|cmd)\b/gi,
  ]

  for (const re of patterns) {
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const raw = m[0]
      const cleaned = raw.replace(/[.,;:)\]]+$/g, '')
      if (!cleaned) continue
      if (seen.has(cleaned)) continue
      seen.add(cleaned)
      out.push(cleaned)
      if (out.length >= limit) return out
    }
  }

  return out
}

function extractCommandLikeLines(text: string, limit: number): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const lines = text.split('\n')

  const re =
    /\b(git|npm|npx|pnpm|yarn|node|bun|tsc|deno|python|pip|cargo|go|dotnet|java|gradle|mvn|bash|sh|pwsh|powershell)\b/i

  for (const line of lines) {
    const s = line.trim()
    if (!s) continue
    if (s.length > 240) continue
    if (!re.test(s)) continue
    if (seen.has(s)) continue
    seen.add(s)
    out.push(s)
    if (out.length >= limit) break
  }

  return out
}

function extractSignalLines(text: string, limit: number): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const lines = text.split('\n')

  const re =
    /(TODO|FIXME|BUG|ERROR|Exception|Traceback|stack|failed|denied|permission|must|should|决定|约定|必须|不要|错误|失败)/i

  for (const line of lines) {
    const s = line.trim()
    if (!s) continue
    if (s.length > 260) continue
    if (!re.test(s)) continue
    if (seen.has(s)) continue
    seen.add(s)
    out.push(s)
    if (out.length >= limit) break
  }

  return out
}

async function summarizeText(provider: LLMProvider, model: string, text: string): Promise<string> {
  let out = ''
  const system = 'You summarize conversations for continuation in a coding assistant. Output a concise structured summary.'
  const messages: ChatMessage[] = [
    {
      role: 'user',
      content:
        `Summarize the conversation context for future turns.\n` +
        `Keep: goals, decisions, constraints, file paths mentioned, unfinished tasks, errors.\n` +
        `If a [KEY REFERENCES] section exists, prioritize its facts and include important file paths/commands explicitly.\n` +
        `Do not include tool call raw dumps unless necessary.\n\n` +
        `CONVERSATION:\n${text}`,
    },
  ]

  for await (const chunk of provider.streamChat({ model, system, messages, tools: [] })) {
    if (chunk.type === 'text_delta') out += chunk.text
    if (chunk.type === 'error') throw new Error(chunk.message)
  }

  return out.trim() || '(empty summary)'
}

async function autoDelegateIfNeeded(opts: {
  provider: LLMProvider
  model: string
  chatHistory: ChatMessage[]
  cwd: string
  providerConfig: GcConfig
  apiKeyOverride?: string
}): Promise<string | null> {
  const lastUser = findLastUserText(opts.chatHistory)
  if (!lastUser) return null
  if (lastUser.includes('[Auto delegated research]')) return null

  const text = lastUser.trim()
  if (text.length < 20) return null
  if (!shouldAutoDelegate(text)) return null

  const toolNames = ['LS', 'Read', 'Glob', 'Grep']
  const tools = toolNames.map(n => getToolByName(n)).filter(Boolean) as any as ToolDef[]
  if (tools.length === 0) return null

  const toolContext: ToolContext = {
    cwd: opts.cwd,
    permissionMode: 'auto',
    model: opts.model,
    providerConfig: opts.providerConfig,
    apiKeyOverride: opts.apiKeyOverride,
    onPermissionRequest: async () => true,
  }

  const system =
    'You are a research sub-agent for a terminal coding assistant. Use the available tools to inspect the local repository. Return a concise report with key findings and file paths.'

  const chatHistory: ChatMessage[] = [
    { role: 'user', content: `Task:\n${text}` },
  ]

  const report = await runSubagentSession({
    provider: opts.provider,
    model: opts.model,
    system,
    chatHistory,
    tools,
    toolContext,
    maxIterations: 6,
  })

  return `[Auto delegated research]\n${report}`
}

function findLastUserText(history: ChatMessage[]): string | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]
    if (m.role !== 'user') continue
    if (typeof m.content === 'string') return m.content
  }
  return null
}

function shouldAutoDelegate(text: string): boolean {
  const t = text.toLowerCase()
  const keywords = [
    '架构', '结构', '梳理', '分析', '定位', '排查', '全局', '整体', '哪里实现', '怎么实现',
    'architecture', 'survey', 'codebase', 'where is', 'how does',
  ]
  return keywords.some(k => t.includes(k))
}
