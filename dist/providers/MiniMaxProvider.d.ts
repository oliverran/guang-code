import type { LLMProvider, StreamChunk, ChatMessage, ProviderTool } from '../types/index.js';
export declare class MiniMaxProvider implements LLMProvider {
    readonly id: "minimax";
    private apiKey;
    private baseUrl;
    private reasoningEffort;
    constructor(apiKey: string, baseUrl?: string, reasoningEffort?: string);
    streamChat(opts: {
        model: string;
        system: string;
        messages: ChatMessage[];
        tools: ProviderTool[];
        signal?: AbortSignal;
    }): AsyncIterable<StreamChunk>;
}
