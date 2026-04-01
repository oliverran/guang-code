import type { ChatMessage, LLMProvider, ProviderTool, ToolCall, ToolContext, ToolDef } from '../types/index.js'

export type SubagentProgress =
  | { type: 'tool_start'; toolName: string }
  | { type: 'tool_done'; toolName: string; toolResult: string; isError?: boolean }

export async function runSubagentSession(opts: {
  provider: LLMProvider
  model: string
  system: string
  chatHistory: ChatMessage[]
  tools: ToolDef[]
  toolContext: ToolContext
  maxIterations: number
  onProgress?: (p: SubagentProgress) => void
  signal?: AbortSignal
  drainIncomingMessages?: () => string[]
}): Promise<string> {
  let iterations = 0
  let fullText = ''

  const providerTools: ProviderTool[] = opts.tools.map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }))

  while (iterations < opts.maxIterations) {
    iterations++
    fullText = ''

    const pendingToolCalls: Map<string, ToolCall & { argsRaw: string }> = new Map()

    const incoming = opts.drainIncomingMessages?.() ?? []
    for (const m of incoming) {
      opts.chatHistory.push({ role: 'user', content: m })
    }

    for await (const chunk of opts.provider.streamChat({
      model: opts.model,
      system: opts.system,
      messages: opts.chatHistory,
      tools: providerTools,
      signal: opts.signal,
    })) {
      if (chunk.type === 'text_delta') {
        fullText += chunk.text
      } else if (chunk.type === 'tool_call_start') {
        pendingToolCalls.set(chunk.id, { id: chunk.id, name: chunk.name, input: {}, argsRaw: '' })
        opts.onProgress?.({ type: 'tool_start', toolName: chunk.name })
      } else if (chunk.type === 'tool_call_delta') {
        const tc = pendingToolCalls.get(chunk.id)
        if (tc) tc.argsRaw += chunk.partialJson
      } else if (chunk.type === 'tool_call_end') {
        const tc = pendingToolCalls.get(chunk.toolCall.id)
        if (tc) tc.input = chunk.toolCall.input
      } else if (chunk.type === 'error') {
        throw new Error(chunk.message)
      }
    }

    const toolCallList = Array.from(pendingToolCalls.values())
      .filter(tc => (tc.input && Object.keys(tc.input).length > 0) || tc.argsRaw)
      .map(tc => {
        if (Object.keys(tc.input).length === 0 && tc.argsRaw) {
          try { tc.input = JSON.parse(tc.argsRaw) } catch {}
        }
        return { id: tc.id, name: tc.name, input: tc.input }
      })

    if (fullText || toolCallList.length > 0) {
      const assistantContent: Array<{ type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }> = []
      if (fullText) assistantContent.push({ type: 'text', text: fullText })
      for (const tc of toolCallList) assistantContent.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input })
      opts.chatHistory.push({ role: 'assistant', content: assistantContent })
    }

    if (toolCallList.length === 0) {
      return fullText.trim() || '(no output)'
    }

    const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }> = []

    for (const tc of toolCallList) {
      const toolDef = opts.tools.find(t => t.name === tc.name)
      if (!toolDef) {
        toolResults.push({ type: 'tool_result', tool_use_id: tc.id, content: `Tool "${tc.name}" not available in sub-agent`, is_error: true })
        opts.onProgress?.({ type: 'tool_done', toolName: tc.name, toolResult: 'Tool not available', isError: true })
        continue
      }

      const approved = await opts.toolContext.onPermissionRequest(
        tc.name,
        `Sub-agent requested tool "${tc.name}" with input:\n${JSON.stringify(tc.input, null, 2)}`,
      )

      if (!approved || approved === 'deny') {
        toolResults.push({ type: 'tool_result', tool_use_id: tc.id, content: 'Permission denied', is_error: true })
        opts.onProgress?.({ type: 'tool_done', toolName: tc.name, toolResult: 'Permission denied', isError: true })
        continue
      }

      const result = await toolDef.execute(tc.input, opts.toolContext)
      toolResults.push({ type: 'tool_result', tool_use_id: tc.id, content: result.content, is_error: result.isError })
      opts.onProgress?.({ type: 'tool_done', toolName: tc.name, toolResult: result.content, isError: result.isError })
    }

    opts.chatHistory.push({ role: 'user', content: toolResults })
  }

  return fullText.trim() || '(no output)'
}
