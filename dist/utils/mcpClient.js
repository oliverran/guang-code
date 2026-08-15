import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'fs';
import path from 'path';
export class McpClientManager {
    clients = new Map();
    transports = new Map();
    async loadConfig(cwd) {
        const configPath = path.join(cwd, '.guang', 'mcp.json');
        if (!fs.existsSync(configPath)) {
            return null;
        }
        try {
            const content = fs.readFileSync(configPath, 'utf-8');
            return JSON.parse(content);
        }
        catch (err) {
            console.error('Failed to load MCP config:', err);
            return null;
        }
    }
    async initializeServer(serverName, config) {
        if (this.clients.has(serverName)) {
            return this.clients.get(serverName);
        }
        const transport = new StdioClientTransport({
            command: config.command,
            args: config.args,
            env: { ...process.env, ...config.env },
        });
        const client = new Client({
            name: `guang-code-${serverName}`,
            version: '1.0.0',
        }, {
            capabilities: {},
        });
        await client.connect(transport);
        this.transports.set(serverName, transport);
        this.clients.set(serverName, client);
        return client;
    }
    async initializeAll(cwd) {
        const config = await this.loadConfig(cwd);
        if (!config || !config.mcpServers)
            return;
        for (const [serverName, serverConfig] of Object.entries(config.mcpServers)) {
            try {
                await this.initializeServer(serverName, serverConfig);
            }
            catch (err) {
                console.error(`Failed to initialize MCP server ${serverName}:`, err);
            }
        }
    }
    getClients() {
        return this.clients;
    }
    async cleanup() {
        for (const [name, client] of this.clients.entries()) {
            try {
                await client.close();
            }
            catch (err) {
                console.error(`Error closing MCP client ${name}:`, err);
            }
        }
        this.clients.clear();
        this.transports.clear();
    }
}
// Global instance
export const mcpManager = new McpClientManager();
