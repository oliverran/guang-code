import type { SessionMessage, PermissionMode, GcConfig, OnStreamChunk } from '../types/index.js';
export type QueryOptions = {
    messages: SessionMessage[];
    model: string;
    cwd: string;
    permissionMode: PermissionMode;
    planApproved?: boolean;
    providerConfig: GcConfig;
    /** Optional API key override (from --api-key CLI flag) */
    apiKeyOverride?: string;
    onPermissionRequest: (toolName: string, description: string) => Promise<boolean | 'always_allow' | 'allow_once' | 'deny'>;
    onStreamChunk: OnStreamChunk;
    signal?: AbortSignal;
};
export declare function runQuery(options: QueryOptions): Promise<{
    messages: SessionMessage[];
    inputTokens: number;
    outputTokens: number;
}>;
