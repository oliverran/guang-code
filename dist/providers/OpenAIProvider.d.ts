import type { LLMProvider, ProviderId, StreamChunk, ChatMessage, ProviderTool } from '../types/index.js';
export declare class OpenAIProvider implements LLMProvider {
    readonly id: ProviderId;
    private client;
    constructor(apiKey: string, opts?: {
        baseUrl?: string;
        providerId?: ProviderId;
    });
    streamChat(opts: {
        model: string;
        system: string;
        messages: ChatMessage[];
        tools: ProviderTool[];
        signal?: AbortSignal;
    }): AsyncIterable<StreamChunk>;
}
