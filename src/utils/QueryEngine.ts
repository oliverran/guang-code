// ============================================================
//  Guang Code — QueryEngine (Provider-agnostic)
//  Works with any LLMProvider: Anthropic, OpenAI, MiniMax, etc.
// ============================================================

import { randomUUID } from 'crypto'
import type {
  SessionMessage,
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
- When running Bash commands, prefer short, safe commands and explain what they do

## Style
- Be concise but informative
- Use code blocks for code snippets
- Don't repeat yourself unnecessarily
- When you encounter errors, analyze them and try to fix them

Current working directory: {{CWD}}
`

export type QueryOptions = {
  messages: SessionMessage[]
  model: string
  cwd: string
  permissionMode: PermissionMode
  providerConfig: GcConfig
  /** Optional API key override (from --api-key CLI flag) */
  apiKeyOverride?: string
  onPermissionRequest: (toolName: string, description: string) => Promise<boolean>
  onStreamChunk: OnStreamChunk
  signal?: AbortSignal
}

const MAX_TOOL_ITERATIONS = 20

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

  const tools = getTools()
  const toolContext: ToolContext = { cwd, permissionMode, onPermissionRequest }

  const providerTools: ProviderTool[] = tools.map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }))

  const systemPrompt = SYSTEM_PROMPT.replace('{{CWD}}', cwd)

  // Build conversation history in provider-agnostic format
  let chatHistory: ChatMessage[] = sessionMessagesToChatMessages(messages)

  let totalInput = 0
  let totalOutput = 0
  const newMessages: SessionMessage[] = []
  let iterations = 0

  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++

    if (signal?.aborted) break

    let fullText = ''
    const pendingToolCalls: Map<string, ToolCall & { argsRaw: string }> = new Map()
    let finalStopReason = 'end_turn'
    let hasToolCalls = false

    try {
      for await (const chunk of provider.streamChat({
        model,
        system: systemPrompt,
        messages: chatHistory,
        tools: providerTools,
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

    // No tool calls or stop → done
    if (toolCallList.length === 0 || finalStopReason === 'end_turn') break

    // ── Execute tool calls ─────────────────────────────────────
    const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }> = []

    for (const tc of toolCallList) {
      const toolDef = getToolByName(tc.name)
      if (!toolDef) {
        toolResults.push({ type: 'tool_result', tool_use_id: tc.id, content: `Tool "${tc.name}" not found`, is_error: true })
        continue
      }

      try {
        const result = await toolDef.execute(tc.input, toolContext)
        onStreamChunk({
          type: 'tool_done',
          toolName: tc.name,
          toolResult: result.isError ? `Error: ${result.content}` : result.content,
        })
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tc.id,
          content: result.content,
          is_error: result.isError,
        })

        newMessages.push({
          id: randomUUID(), role: 'assistant',
          content: `[Tool: ${tc.name}]\nInput: ${JSON.stringify(tc.input, null, 2)}`,
          timestamp: Date.now(), toolUseId: tc.id,
        })
        newMessages.push({
          id: randomUUID(), role: 'user',
          content: `[Tool Result: ${tc.name}]\n${result.content}`,
          timestamp: Date.now(), toolUseId: tc.id,
        })
      } catch (err: unknown) {
        const e = err as Error
        toolResults.push({ type: 'tool_result', tool_use_id: tc.id, content: `Tool error: ${e.message}`, is_error: true })
      }
    }

    // Feed results back into history
    chatHistory.push({ role: 'user', content: toolResults })

    onStreamChunk({ type: 'tool_start', toolName: '…' }) // re-enter spinner
  }

  onStreamChunk({ type: 'done', inputTokens: totalInput, outputTokens: totalOutput })
  return { messages: newMessages, inputTokens: totalInput, outputTokens: totalOutput }
}

// ── Helpers ────────────────────────────────────────────────────────

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
