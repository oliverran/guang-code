import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import fs from 'fs'
import path from 'path'

export type McpServerConfig = {
  command: string
  args: string[]
  env?: Record<string, string>
}

export type McpConfig = {
  mcpServers: Record<string, McpServerConfig>
}

export class McpClientManager {
  private clients: Map<string, Client> = new Map()
  private transports: Map<string, StdioClientTransport> = new Map()

  async loadConfig(cwd: string): Promise<McpConfig | null> {
    const configPath = path.join(cwd, '.guang', 'mcp.json')
    if (!fs.existsSync(configPath)) {
      return null
    }

    try {
      const content = fs.readFileSync(configPath, 'utf-8')
      return JSON.parse(content) as McpConfig
    } catch (err) {
      console.error('Failed to load MCP config:', err)
      return null
    }
  }

  async initializeServer(serverName: string, config: McpServerConfig): Promise<Client> {
    if (this.clients.has(serverName)) {
      return this.clients.get(serverName)!
    }

    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: { ...process.env, ...config.env } as Record<string, string>,
    })

    const client = new Client(
      {
        name: `guang-code-${serverName}`,
        version: '1.0.0',
      },
      {
        capabilities: {},
      }
    )

    await client.connect(transport)
    
    this.transports.set(serverName, transport)
    this.clients.set(serverName, client)
    
    return client
  }

  async initializeAll(cwd: string): Promise<void> {
    const config = await this.loadConfig(cwd)
    if (!config || !config.mcpServers) return

    for (const [serverName, serverConfig] of Object.entries(config.mcpServers)) {
      try {
        await this.initializeServer(serverName, serverConfig)
      } catch (err) {
        console.error(`Failed to initialize MCP server ${serverName}:`, err)
      }
    }
  }

  getClients(): Map<string, Client> {
    return this.clients
  }

  async cleanup(): Promise<void> {
    for (const [name, client] of this.clients.entries()) {
      try {
        await client.close()
      } catch (err) {
        console.error(`Error closing MCP client ${name}:`, err)
      }
    }
    this.clients.clear()
    this.transports.clear()
  }
}

// Global instance
export const mcpManager = new McpClientManager()
