import type { ChatMessage, LLMProvider, ToolContext, ToolDef } from '../types/index.js';
export type SubagentProgress = {
    type: 'tool_start';
    toolName: string;
} | {
    type: 'tool_done';
    toolName: string;
    toolResult: string;
    isError?: boolean;
};
export declare function runSubagentSession(opts: {
    provider: LLMProvider;
    model: string;
    system: string;
    chatHistory: ChatMessage[];
    tools: ToolDef[];
    toolContext: ToolContext;
    maxIterations: number;
    onProgress?: (p: SubagentProgress) => void;
    signal?: AbortSignal;
    drainIncomingMessages?: () => string[];
}): Promise<string>;
