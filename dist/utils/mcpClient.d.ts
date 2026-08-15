import { Client } from '@modelcontextprotocol/sdk/client/index.js';
export type McpServerConfig = {
    command: string;
    args: string[];
    env?: Record<string, string>;
};
export type McpConfig = {
    mcpServers: Record<string, McpServerConfig>;
};
export declare class McpClientManager {
    private clients;
    private transports;
    loadConfig(cwd: string): Promise<McpConfig | null>;
    initializeServer(serverName: string, config: McpServerConfig): Promise<Client>;
    initializeAll(cwd: string): Promise<void>;
    getClients(): Map<string, Client>;
    cleanup(): Promise<void>;
}
export declare const mcpManager: McpClientManager;
