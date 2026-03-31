// ============================================================
//  Guang Code — MiniMax Provider
//  MiniMax uses an OpenAI-compatible chat completions API.
//  Docs: https://platform.minimaxi.com/document/ChatCompletion
// ============================================================

import type {
  LLMProvider,
  StreamChunk,
  ChatMessage,
  ProviderTool,
} from '../types/index.js'

const MINIMAX_BASE_URL = 'https://api.minimaxi.chat/v1'

type MiniMaxChunk = {
  id: string
  choices: Array<{
    index: number
    delta: {
      role?: string
      content?: string
      tool_calls?: Array<{
        index: number
        id?: string
        type?: string
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason?: string | null
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

export class MiniMaxProvider implements LLMProvider {
  readonly id = 'minimax' as const
  private apiKey: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  async *streamChat(opts: {
    model: string
    system: string
    messages: ChatMessage[]
    tools: ProviderTool[]
    signal?: AbortSignal
  }): AsyncIterable<StreamChunk> {
    const { model, system, messages, tools, signal } = opts

    // Build OpenAI-compatible messages
    const apiMessages: Array<Record<string, unknown>> = [
      { role: 'system', content: system },
    ]

    for (const m of messages) {
      if (m.role === 'system') continue

      if (m.role === 'user') {
        if (typeof m.content === 'string') {
          apiMessages.push({ role: 'user', content: m.content })
        } else {
          for (const r of m.content as Array<{ type: string; tool_use_id: string; content: string; is_error?: boolean }>) {
            apiMessages.push({
              role: 'tool',
              tool_call_id: r.tool_use_id,
              content: r.is_error ? `Error: ${r.content}` : r.content,
            })
          }
        }
        continue
      }

      if (m.role === 'assistant') {
        if (typeof m.content === 'string') {
          apiMessages.push({ role: 'assistant', content: m.content })
        } else {
          const parts = m.content as Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>
          const textParts = parts.filter(p => p.type === 'text').map(p => p.text ?? '').join('')
          const toolUseParts = parts.filter(p => p.type === 'tool_use')
          apiMessages.push({
            role: 'assistant',
            content: textParts || '',
            tool_calls: toolUseParts.length > 0 ? toolUseParts.map(p => ({
              id: p.id,
              type: 'function',
              function: { name: p.name, arguments: JSON.stringify(p.input ?? {}) },
            })) : undefined,
          })
        }
      }
    }

    const toolDefs = tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }))

    const body = {
      model,
      messages: apiMessages,
      tools: toolDefs.length > 0 ? toolDefs : undefined,
      tool_choice: toolDefs.length > 0 ? 'auto' : undefined,
      stream: true,
      max_tokens: 8096,
    }

    try {
      const response = await fetch(`${MINIMAX_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      })

      if (!response.ok) {
        const errText = await response.text()
        yield { type: 'error', message: `MiniMax API error ${response.status}: ${errText}` }
        return
      }

      const reader = response.body?.getReader()
      if (!reader) {
        yield { type: 'error', message: 'No response body from MiniMax API' }
        return
      }

      const decoder = new TextDecoder()
      let buffer = ''
      const toolCallAccum: Record<number, { id: string; name: string; argsRaw: string }> = {}

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (signal?.aborted) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data:')) continue
          const data = trimmed.slice(5).trim()
          if (data === '[DONE]') continue

          let chunk: MiniMaxChunk
          try { chunk = JSON.parse(data) } catch { continue }

          const delta = chunk.choices?.[0]?.delta
          if (!delta) {
            if (chunk.usage) {
              yield {
                type: 'done',
                stopReason: 'end_turn',
                inputTokens: chunk.usage.prompt_tokens,
                outputTokens: chunk.usage.completion_tokens,
              }
            }
            continue
          }

          if (delta.content) {
            yield { type: 'text_delta', text: delta.content }
          }

          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0
              if (!toolCallAccum[idx]) {
                toolCallAccum[idx] = { id: tc.id ?? '', name: tc.function?.name ?? '', argsRaw: '' }
                yield { type: 'tool_call_start', id: toolCallAccum[idx].id, name: toolCallAccum[idx].name }
              }
              if (tc.function?.arguments) {
                toolCallAccum[idx].argsRaw += tc.function.arguments
                yield { type: 'tool_call_delta', id: toolCallAccum[idx].id, partialJson: tc.function.arguments }
              }
            }
          }

          const finishReason = chunk.choices?.[0]?.finish_reason
          if (finishReason === 'tool_calls' || finishReason === 'stop') {
            for (const tc of Object.values(toolCallAccum)) {
              let input: Record<string, unknown> = {}
              try { input = JSON.parse(tc.argsRaw || '{}') } catch { /* */ }
              yield { type: 'tool_call_end', toolCall: { id: tc.id, name: tc.name, input } }
            }
            for (const k of Object.keys(toolCallAccum)) delete toolCallAccum[Number(k)]
          }
        }
      }
    } catch (err: unknown) {
      const e = err as Error
      if (e.name !== 'AbortError') {
        yield { type: 'error', message: `MiniMax error: ${e.message}` }
      }
    }
  }
}
