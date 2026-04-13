import type { ProviderTool, ToolContext } from '../types/index.js'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'

// We need an executable tool interface similar to our internal tools
export interface ExecutableTool extends ProviderTool {
  execute(input: Record<string, unknown>, context: ToolContext): Promise<{ content: string; isError?: boolean }>
}

export async function createMcpTools(client: Client, serverName: string): Promise<ExecutableTool[]> {
  try {
    const { tools } = await client.listTools()
    
    return tools.map(mcpTool => {
      const rawName = `mcp.${serverName}.${mcpTool.name}`
      const toolName = rawName.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 64)

      return {
        name: toolName,
        description: `[MCP: ${serverName}] ${mcpTool.description || `Execute ${mcpTool.name}`}`,
        inputSchema: mcpTool.inputSchema as any,
        async execute(input: Record<string, unknown>, context: ToolContext) {
          try {
            const result = await client.callTool({
              name: mcpTool.name,
              arguments: input
            })

            // Format the result to string
            let content = ''
            if (result.content && Array.isArray(result.content)) {
              content = result.content.map(c => {
                if (c.type === 'text') return c.text
                if (c.type === 'image') return '[Image Data]'
                return JSON.stringify(c)
              }).join('\n')
            } else {
              content = JSON.stringify(result)
            }

            return {
              content: content || 'Success (no output)',
              isError: Boolean(result.isError)
            }
          } catch (error: unknown) {
            const e = error as Error
            return {
              content: `Failed to execute MCP tool: ${e.message}`,
              isError: true
            }
          }
        }
      }
    })
  } catch (error) {
    console.error(`Failed to list tools for MCP server ${serverName}:`, error)
    return []
  }
}
