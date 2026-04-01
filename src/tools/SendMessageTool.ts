import type { ToolDef, ToolContext, ToolResult } from '../types/index.js'
import { subagentTasks } from '../utils/subagentTasks.js'

export const SendMessageTool: ToolDef = {
  name: 'SendMessage',
  description: 'Send a follow-up message to a running background Task (sub-agent) by id or name.',
  inputSchema: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Task id or task name' },
      message: { type: 'string', description: 'Message to send to the sub-agent' },
    },
    required: ['to', 'message'],
  },

  async execute(input: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
    const to = (input.to ?? '').toString().trim()
    const message = (input.message ?? '').toString()
    if (!to) return { content: 'SendMessage.to is required', isError: true }
    if (!message.trim()) return { content: 'SendMessage.message is required', isError: true }

    const res = subagentTasks.enqueueMessage(to, message)
    if (!res.ok) return { content: res.error ?? 'Failed to send message', isError: true }
    return { content: `Message delivered to task ${to}` }
  },
}

