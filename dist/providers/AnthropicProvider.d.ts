import type { LLMProvider, StreamChunk, ChatMessage, ProviderTool } from '../types/index.js';
export declare class AnthropicProvider implements LLMProvider {
    readonly id: "anthropic";
    private client;
    constructor(apiKey: string);
    streamChat(opts: {
        model: string;
        system: string;
        messages: ChatMessage[];
        tools: ProviderTool[];
        signal?: AbortSignal;
    }): AsyncIterable<StreamChunk>;
}
