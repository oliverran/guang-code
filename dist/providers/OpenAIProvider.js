// ============================================================
//  Guang Code — OpenAI Provider
//  Supports: GPT-4o, o1/o3/o4, plus any OpenAI-compatible API
//  (DeepSeek, Qwen, Mistral, Groq, etc.)
// ============================================================
import OpenAI from 'openai';
export class OpenAIProvider {
    id;
    client;
    constructor(apiKey, opts) {
        this.id = opts?.providerId ?? 'openai';
        this.client = new OpenAI({
            apiKey,
            baseURL: opts?.baseUrl,
        });
    }
    async *streamChat(opts) {
        const { model, system, messages, tools, signal } = opts;
        // Convert ChatMessage[] → OpenAI format
        const apiMessages = [
            { role: 'system', content: system },
        ];
        for (const m of messages) {
            if (m.role === 'system')
                continue;
            if (m.role === 'user') {
                if (typeof m.content === 'string') {
                    apiMessages.push({ role: 'user', content: m.content });
                }
                else {
                    // Tool results — emit one tool message per result
                    for (const r of m.content) {
                        apiMessages.push({
                            role: 'tool',
                            tool_call_id: r.tool_use_id,
                            content: r.is_error ? `Error: ${r.content}` : r.content,
                        });
                    }
                }
                continue;
            }
            if (m.role === 'assistant') {
                if (typeof m.content === 'string') {
                    apiMessages.push({ role: 'assistant', content: m.content });
                }
                else {
                    // May contain text + tool_use blocks
                    const parts = m.content;
                    const textParts = parts.filter(p => p.type === 'text').map(p => p.text ?? '').join('');
                    const toolUseParts = parts.filter(p => p.type === 'tool_use');
                    const toolCalls = toolUseParts.map(p => ({
                        id: p.id ?? '',
                        type: 'function',
                        function: {
                            name: p.name ?? '',
                            arguments: JSON.stringify(p.input ?? {}),
                        },
                    }));
                    apiMessages.push({
                        role: 'assistant',
                        content: textParts || null,
                        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
                    });
                }
            }
        }
        // Build tool definitions
        const oaiTools = tools.map(t => ({
            type: 'function',
            function: {
                name: t.name,
                description: t.description,
                parameters: t.inputSchema,
            },
        }));
        // Reasoning models (o1/o3/o4) don't support streaming or tools the same way
        const isReasoningModel = /^o[1-9]/.test(model);
        try {
            const stream = await this.client.chat.completions.create({
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
            }, { signal });
            // Accumulate tool call deltas by index
            const toolCallAccum = {};
            let lastFinishReason = 'end_turn';
            for await (const chunk of stream) {
                if (signal?.aborted)
                    break;
                const delta = chunk.choices[0]?.delta;
                const chunkFinishReason = chunk.choices[0]?.finish_reason;
                if (chunkFinishReason)
                    lastFinishReason = chunkFinishReason;
                if (!delta) {
                    // usage chunk
                    const usage = chunk.usage;
                    if (usage) {
                        yield {
                            type: 'done',
                            stopReason: lastFinishReason,
                            inputTokens: usage.prompt_tokens ?? 0,
                            outputTokens: usage.completion_tokens ?? 0,
                        };
                    }
                    continue;
                }
                // Text delta
                if (delta.content) {
                    yield { type: 'text_delta', text: delta.content };
                }
                // Tool call deltas
                if (delta.tool_calls) {
                    for (const tc of delta.tool_calls) {
                        const idx = tc.index ?? 0;
                        if (!toolCallAccum[idx]) {
                            toolCallAccum[idx] = { id: tc.id ?? '', name: tc.function?.name ?? '', argsRaw: '' };
                            yield { type: 'tool_call_start', id: toolCallAccum[idx].id, name: toolCallAccum[idx].name };
                        }
                        if (tc.function?.arguments) {
                            toolCallAccum[idx].argsRaw += tc.function.arguments;
                            yield { type: 'tool_call_delta', id: toolCallAccum[idx].id, partialJson: tc.function.arguments };
                        }
                    }
                }
                // Finish
                const finishReason = chunk.choices[0]?.finish_reason;
                if (finishReason === 'tool_calls' || finishReason === 'stop') {
                    // Emit tool_call_end for all accumulated tool calls
                    for (const tc of Object.values(toolCallAccum)) {
                        let input = {};
                        try {
                            input = JSON.parse(tc.argsRaw || '{}');
                        }
                        catch { /* */ }
                        yield { type: 'tool_call_end', toolCall: { id: tc.id, name: tc.name, input } };
                    }
                    // Clear for next round
                    for (const k of Object.keys(toolCallAccum))
                        delete toolCallAccum[Number(k)];
                }
            }
        }
        catch (err) {
            const e = err;
            yield { type: 'error', message: e.message };
        }
    }
}
