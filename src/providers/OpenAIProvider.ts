// ============================================================
//  Guang Code — OpenAI Provider
//  Supports: GPT-4o, o1/o3/o4, plus any OpenAI-compatible API
//  (DeepSeek, Qwen, Mistral, Groq, etc.)
// ============================================================

import OpenAI from 'openai'
import type {
  LLMProvider,
  ProviderId,
  StreamChunk,
  ChatMessage,
  ProviderTool,
} from '../types/index.js'

export class OpenAIProvider implements LLMProvider {
  readonly id: ProviderId
  private client: OpenAI

  constructor(apiKey: string, opts?: { baseUrl?: string; providerId?: ProviderId }) {
    this.id = opts?.providerId ?? 'openai'
    this.client = new OpenAI({
      apiKey,
      baseURL: opts?.baseUrl,
    })
  }

  async *streamChat(opts: {
    model: string
    system: string
    messages: ChatMessage[]
    tools: ProviderTool[]
    signal?: AbortSignal
  }): AsyncIterable<StreamChunk> {
    const { model, system, messages, tools, signal } = opts

    // Convert ChatMessage[] → OpenAI format
    const apiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: system },
    ]

    for (const m of messages) {
      if (m.role === 'system') continue

      if (m.role === 'user') {
        if (typeof m.content === 'string') {
          apiMessages.push({ role: 'user', content: m.content })
        } else {
          // Tool results — emit one tool message per result
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
          // May contain text + tool_use blocks
          const parts = m.content as Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>
          const textParts = parts.filter(p => p.type === 'text').map(p => p.text ?? '').join('')
          const toolUseParts = parts.filter(p => p.type === 'tool_use')

          const toolCalls: OpenAI.Chat.ChatCompletionMessageToolCall[] = toolUseParts.map(p => ({
            id: p.id ?? '',
            type: 'function' as const,
            function: {
              name: p.name ?? '',
              arguments: JSON.stringify(p.input ?? {}),
            },
          }))

          apiMessages.push({
            role: 'assistant',
            content: textParts || null,
            tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          })
        }
      }
    }

    // Build tool definitions
    const oaiTools: OpenAI.Chat.ChatCompletionTool[] = tools.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema as Record<string, unknown>,
      },
    }))

    // Reasoning models (o1/o3/o4) don't support streaming or tools the same way
    const isReasoningModel = /^o[1-9]/.test(model)

    try {
      const stream = await this.client.chat.completions.create(
        {
          model,
          messages: apiMessages,
          tools: oaiTools.length > 0 && !isReasoningModel ? oaiTools : undefined,
          tool_choice: oaiTools.length > 0 && !isReasoningModel ? 'auto' : undefined,
          stream: true,
          stream_options: { include_usage: true },
          // reasoning models need max_completion_tokens not max_tokens
          ...(isReasoningModel
            ? { max_completion_tokens: 16000 }
            : { max_tokens: 8096 }),
        } as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
        { signal },
      )

      // Accumulate tool call deltas by index
      const toolCallAccum: Record<number, { id: string; name: string; argsRaw: string }> = {}
      let lastFinishReason = 'end_turn'

      for await (const chunk of stream) {
        if (signal?.aborted) break

        const delta = chunk.choices[0]?.delta as Record<string, any> | undefined
        const chunkFinishReason = chunk.choices[0]?.finish_reason
        if (chunkFinishReason) lastFinishReason = chunkFinishReason

        if (!delta) {
          // usage chunk
          const usage = (chunk as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage
          if (usage) {
            yield {
              type: 'done',
              stopReason: lastFinishReason,
              inputTokens: usage.prompt_tokens ?? 0,
              outputTokens: usage.completion_tokens ?? 0,
            }
          }
          continue
        }

        // Text delta
        if (delta.content) {
          yield { type: 'text_delta', text: delta.content }
        }

        // Tool call deltas
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

        // Finish
        const finishReason = chunk.choices[0]?.finish_reason
        if (finishReason === 'tool_calls' || finishReason === 'stop') {
          // Emit tool_call_end for all accumulated tool calls
          for (const tc of Object.values(toolCallAccum)) {
            let input: Record<string, unknown> = {}
            try { input = JSON.parse(tc.argsRaw || '{}') } catch { /* */ }
            yield { type: 'tool_call_end', toolCall: { id: tc.id, name: tc.name, input } }
          }
          // Clear for next round
          for (const k of Object.keys(toolCallAccum)) delete toolCallAccum[Number(k)]
        }
      }
    } catch (err: unknown) {
      const e = err as Error
      yield { type: 'error', message: e.message }
    }
  }
}
