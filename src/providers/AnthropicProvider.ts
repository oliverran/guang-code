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

    // Convert to Anthropic message format
    const apiMessages: Anthropic.MessageParam[] = messages
      .filter(m => m.role !== 'system')
      .map(m => {
        if (m.role === 'user') {
          if (typeof m.content === 'string') {
            return { role: 'user' as const, content: m.content }
          }
          // Tool results
          const toolResults = (m.content as Array<{ type: string; tool_use_id: string; content: string; is_error?: boolean }>)
          return {
            role: 'user' as const,
            content: toolResults.map(r => ({
              type: 'tool_result' as const,
              tool_use_id: r.tool_use_id,
              content: r.content,
              is_error: r.is_error,
            })),
          }
        }
        // assistant
        if (typeof m.content === 'string') {
          return { role: 'assistant' as const, content: m.content }
        }
        const parts = m.content as Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>
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

    const anthropicTools: Anthropic.Tool[] = tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool['input_schema'],
    }))

    const stream = await this.client.messages.create(
      {
        model,
        max_tokens: 8096,
        system,
        messages: apiMessages,
        tools: anthropicTools,
        stream: true,
      },
      { signal },
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
        const inp = event.message.usage?.input_tokens ?? 0
        if (inp > 0) {
          yield { type: 'done', stopReason: '_input_tokens', inputTokens: inp, outputTokens: 0 }
        }
      }
    }
  }
}
