export async function runSubagentSession(opts) {
    let iterations = 0;
    let fullText = '';
    const providerTools = opts.tools.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
    }));
    while (iterations < opts.maxIterations) {
        iterations++;
        fullText = '';
        const pendingToolCalls = new Map();
        const incoming = opts.drainIncomingMessages?.() ?? [];
        for (const m of incoming) {
            opts.chatHistory.push({ role: 'user', content: m });
        }
        for await (const chunk of opts.provider.streamChat({
            model: opts.model,
            system: opts.system,
            messages: opts.chatHistory,
            tools: providerTools,
            signal: opts.signal,
        })) {
            if (chunk.type === 'text_delta') {
                fullText += chunk.text;
            }
            else if (chunk.type === 'tool_call_start') {
                pendingToolCalls.set(chunk.id, { id: chunk.id, name: chunk.name, input: {}, argsRaw: '' });
                opts.onProgress?.({ type: 'tool_start', toolName: chunk.name });
            }
            else if (chunk.type === 'tool_call_delta') {
                const tc = pendingToolCalls.get(chunk.id);
                if (tc)
                    tc.argsRaw += chunk.partialJson;
            }
            else if (chunk.type === 'tool_call_end') {
                const tc = pendingToolCalls.get(chunk.toolCall.id);
                if (tc)
                    tc.input = chunk.toolCall.input;
            }
            else if (chunk.type === 'error') {
                throw new Error(chunk.message);
            }
        }
        const toolCallList = Array.from(pendingToolCalls.values())
            .filter(tc => (tc.input && Object.keys(tc.input).length > 0) || tc.argsRaw)
            .map(tc => {
            if (Object.keys(tc.input).length === 0 && tc.argsRaw) {
                try {
                    tc.input = JSON.parse(tc.argsRaw);
                }
                catch { }
            }
            return { id: tc.id, name: tc.name, input: tc.input };
        });
        if (fullText || toolCallList.length > 0) {
            const assistantContent = [];
            if (fullText)
                assistantContent.push({ type: 'text', text: fullText });
            for (const tc of toolCallList)
                assistantContent.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
            opts.chatHistory.push({ role: 'assistant', content: assistantContent });
        }
        if (toolCallList.length === 0) {
            return fullText.trim() || '(no output)';
        }
        const toolResults = [];
        for (const tc of toolCallList) {
            const toolDef = opts.tools.find(t => t.name === tc.name);
            if (!toolDef) {
                toolResults.push({ type: 'tool_result', tool_use_id: tc.id, content: `Tool "${tc.name}" not available in sub-agent`, is_error: true });
                opts.onProgress?.({ type: 'tool_done', toolName: tc.name, toolResult: 'Tool not available', isError: true });
                continue;
            }
            const approved = await opts.toolContext.onPermissionRequest(tc.name, `Sub-agent requested tool "${tc.name}" with input:\n${JSON.stringify(tc.input, null, 2)}`);
            if (!approved || approved === 'deny') {
                toolResults.push({ type: 'tool_result', tool_use_id: tc.id, content: 'Permission denied', is_error: true });
                opts.onProgress?.({ type: 'tool_done', toolName: tc.name, toolResult: 'Permission denied', isError: true });
                continue;
            }
            const result = await toolDef.execute(tc.input, opts.toolContext);
            toolResults.push({ type: 'tool_result', tool_use_id: tc.id, content: result.content, is_error: result.isError });
            opts.onProgress?.({ type: 'tool_done', toolName: tc.name, toolResult: result.content, isError: result.isError });
        }
        opts.chatHistory.push({ role: 'user', content: toolResults });
    }
    return fullText.trim() || '(no output)';
}
