import type { ProviderTool, ToolContext } from '../types/index.js';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
export interface ExecutableTool extends ProviderTool {
    execute(input: Record<string, unknown>, context: ToolContext): Promise<{
        content: string;
        isError?: boolean;
    }>;
}
export declare function createMcpTools(client: Client, serverName: string): Promise<ExecutableTool[]>;
