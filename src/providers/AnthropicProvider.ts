// ============================================================
//  Guang Code — Anthropic Provider
//  Uses @anthropic-ai/sdk with native streaming
// ============================================================

import Anthropic from '@anthropic-ai/sdk'
import type {
  LLMProvider,
  StreamChunk,
  ChatMessage,
  ProviderTool,
} from '../types/index.js'

export class AnthropicProvider implements LLMProvider {
  readonly id = 'anthropic' as const
  private client: Anthropic

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey })
  }

  async *streamChat(opts: {
    model: string
    system: string
    messages: ChatMessage[]
    tools: ProviderTool[]
    signal?: AbortSignal
  }): AsyncIterable<StreamChunk> {
    const { model, system, messages, tools, signal } = opts

    // Filter and prepare cache breakpoints
    const filteredMessages = messages.filter(m => m.role !== 'system')
    const userMessageIndices = filteredMessages
      .map((m, i) => (m.role === 'user' ? i : -1))
      .filter(i => i !== -1)

    // Select the last two user messages as cache breakpoints
    const lastUserIdx = userMessageIndices[userMessageIndices.length - 1]
    const secondLastUserIdx = userMessageIndices[userMessageIndices.length - 2]

    // Convert to Anthropic message format
    const apiMessages: Anthropic.MessageParam[] = filteredMessages.map((m, index) => {
      const isCachePoint = index === lastUserIdx || index === secondLastUserIdx
      const cacheControl: Anthropic.CacheControlEphemeral | null = isCachePoint
        ? { type: 'ephemeral' }
        : null

      if (m.role === 'user') {
        if (typeof m.content === 'string') {
          return {
            role: 'user' as const,
            content: [
              {
                type: 'text',
                text: m.content,
                ...(cacheControl ? { cache_control: cacheControl } : {}),
              },
            ],
          }
        }
        // Tool results
        const toolResults = m.content as Array<{
          type: string
          tool_use_id: string
          content: string
          is_error?: boolean
        }>
        return {
          role: 'user' as const,
          content: toolResults.map((r, rIdx) => ({
            type: 'tool_result' as const,
            tool_use_id: r.tool_use_id,
            content: r.content,
            is_error: r.is_error,
            // Add cache control to the last block of this message
            ...(cacheControl && rIdx === toolResults.length - 1
              ? { cache_control: cacheControl }
              : {}),
          })),
        }
      }

      // assistant
      if (typeof m.content === 'string') {
        return { role: 'assistant' as const, content: m.content }
      }
      const parts = m.content as Array<{
        type: string
        text?: string
        id?: string
        name?: string
        input?: Record<string, unknown>
      }>
      return {
        role: 'assistant' as const,
        content: parts.map(p => {
          if (p.type === 'text') {
            return { type: 'text' as const, text: p.text ?? '' }
          }
          return {
            type: 'tool_use' as const,
            id: p.id ?? '',
            name: p.name ?? '',
            input: p.input ?? {},
          }
        }),
      }
    })

    const anthropicTools: Anthropic.Tool[] = tools.map((t, index) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool['input_schema'],
      // Add cache control to the last tool definition
      ...(index === tools.length - 1 ? { cache_control: { type: 'ephemeral' } } : {}),
    }))

    const stream = await this.client.messages.create(
      {
        model,
        max_tokens: 8096,
        system: system
          ? [
              {
                type: 'text',
                text: system,
                cache_control: { type: 'ephemeral' },
              },
            ]
          : undefined,
        messages: apiMessages,
        tools: anthropicTools.length > 0 ? anthropicTools : undefined,
        stream: true,
      },
      {
        signal,
        headers: {
          'anthropic-beta': 'prompt-caching-2024-07-31',
        },
      },
    )

    let currentToolId = ''
    let currentToolName = ''
    let currentToolInputRaw = ''

    for await (const event of stream) {
      if (signal?.aborted) break

      if (event.type === 'content_block_start') {
        if (event.content_block.type === 'tool_use') {
          currentToolId = event.content_block.id
          currentToolName = event.content_block.name
          currentToolInputRaw = ''
          yield { type: 'tool_call_start', id: currentToolId, name: currentToolName }
        }
      } else if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          yield { type: 'text_delta', text: event.delta.text }
        } else if (event.delta.type === 'input_json_delta') {
          currentToolInputRaw += event.delta.partial_json
          yield { type: 'tool_call_delta', id: currentToolId, partialJson: event.delta.partial_json }
        }
      } else if (event.type === 'content_block_stop') {
        if (currentToolId && currentToolName) {
          let parsedInput: Record<string, unknown> = {}
          try { parsedInput = JSON.parse(currentToolInputRaw || '{}') } catch { /* */ }
          yield {
            type: 'tool_call_end',
            toolCall: { id: currentToolId, name: currentToolName, input: parsedInput },
          }
          currentToolId = ''
          currentToolName = ''
          currentToolInputRaw = ''
        }
      } else if (event.type === 'message_delta') {
        yield {
          type: 'done',
          stopReason: event.delta.stop_reason ?? 'end_turn',
          inputTokens: 0,
          outputTokens: event.usage?.output_tokens ?? 0,
        }
      } else if (event.type === 'message_start') {
        // Input tokens arrive here; we yield a special done-like signal later
        // Store input tokens in a done event from message_start
        const usage = event.message.usage
        const inp = usage?.input_tokens ?? 0
        const cacheRead = (usage as any)?.cache_read_input_tokens ?? 0
        
        if (inp > 0 || cacheRead > 0) {
          yield { 
            type: 'done', 
            stopReason: '_input_tokens', 
            inputTokens: inp + cacheRead, 
            outputTokens: 0 
          }
        }
      }
    }
  }
}
