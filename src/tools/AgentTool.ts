import { resolve } from 'path'
import type { ToolDef, ToolContext, ToolResult, ChatMessage, LLMProvider } from '../types/index.js'
import { createProvider } from '../providers/index.js'
import { loadConfig } from '../utils/config.js'
import { createSubagentId, emitSubagentEvent } from '../utils/subagents.js'
import { runSubagentSession } from '../utils/subagentRun.js'
import { subagentTasks } from '../utils/subagentTasks.js'
import { ListDirTool } from './ListDirTool.js'
import { FileReadTool } from './FileReadTool.js'
import { GlobTool } from './GlobTool.js'
import { GrepTool } from './GrepTool.js'
import { FileWriteTool } from './FileWriteTool.js'
import { FileEditTool } from './FileEditTool.js'
import { BashTool } from './BashTool.js'

type AgentToolInput = {
  description?: string
  query: string
  subagent_type?: string
  response_language?: string
  model?: string
  name?: string
  run_in_background?: boolean
  cwd?: string
  allowed_tools?: string[]
  denied_tools?: string[]
  timeout_ms?: string
}

const MAX_SUBAGENT_TOOL_ITERATIONS = 12

export const AgentTool: ToolDef = {
  name: 'Task',
  description: 'Launch a sub-agent to perform a focused task (research, code reading, or implementation) and return its final report.',
  inputSchema: {
    type: 'object',
    properties: {
      description: { type: 'string', description: 'Short description of the task (3-8 words).' },
      query: { type: 'string', description: 'The task to perform (clear, specific requirements).' },
      subagent_type: { type: 'string', description: 'Type of sub-agent (e.g. search, coder).' },
      response_language: { type: 'string', description: 'Language for the final report (e.g. zh-CN, en).' },
      model: { type: 'string', description: 'Optional model override for this sub-agent.' },
      name: { type: 'string', description: 'Optional sub-agent name (for /tasks and SendMessage).' },
      run_in_background: { type: 'string', description: 'Run in background (true/false)', enum: ['true', 'false'], default: 'false' },
      cwd: { type: 'string', description: 'Optional working directory for the sub-agent (relative to current cwd or absolute).' },
      allowed_tools: { type: 'string', description: 'Comma-separated tool allowlist (optional).' },
      denied_tools: { type: 'string', description: 'Comma-separated tool denylist (optional).' },
      timeout_ms: { type: 'string', description: 'Timeout in milliseconds for background task (optional).' },
    },
    required: ['query'],
  },

  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const parsed = input as AgentToolInput
    const query = (parsed.query ?? '').toString().trim()
    if (!query) return { content: 'Task.query is required', isError: true }

    const subagentType = (parsed.subagent_type ?? 'search').toString().trim().toLowerCase()
    const description = (parsed.description ?? '').toString().trim()
    const responseLanguage = (parsed.response_language ?? '').toString().trim()
    const runInBackground = (input.run_in_background as string | undefined) === 'true'
    const name = (parsed.name ?? '').toString().trim() || undefined
    const targetCwd = resolve(ctx.cwd, (parsed.cwd ?? '').toString().trim() || '.')
    const allowedTools = parseToolList(input.allowed_tools)
    const deniedTools = parseToolList(input.denied_tools)
    const timeoutMs = (() => {
      const raw = (parsed.timeout_ms ?? '').toString().trim()
      if (!raw) return undefined
      const n = Number(raw)
      return Number.isFinite(n) && n > 0 ? n : undefined
    })()

    const model = (parsed.model ?? ctx.model ?? '').toString().trim()
    if (!model) {
      return { content: 'No model configured for sub-agent', isError: true }
    }

    const providerConfig = ctx.providerConfig ?? await loadConfig()
    const provider = createProvider(model, providerConfig, ctx.apiKeyOverride)

    const tools = filterTools(getSubagentTools(subagentType), allowedTools, deniedTools)

    const system = buildSubagentSystemPrompt({ subagentType, description, responseLanguage })
    const chatHistory: ChatMessage[] = [
      { role: 'user', content: buildSubagentUserPrompt({ description, query }) },
    ]

    try {
      const id = createSubagentId()
      const subCtx: ToolContext = {
        ...ctx,
        cwd: targetCwd,
        model,
        providerConfig,
        apiKeyOverride: ctx.apiKeyOverride,
        onPermissionRequest: async (toolName: string, desc: string) => {
          if (!runInBackground) return ctx.onPermissionRequest(toolName, desc)
          if (['LS', 'Read', 'Glob', 'Grep'].includes(toolName)) return true
          return 'deny'
        },
      }

      if (runInBackground) {
        const task = subagentTasks.create({
          name,
          description: description || query.slice(0, 80),
          timeoutMs,
          params: {
            description,
            query,
            subagent_type: subagentType,
            response_language: responseLanguage,
            model,
            cwd: targetCwd,
            allowed_tools: allowedTools ?? undefined,
            denied_tools: deniedTools ?? undefined,
            timeout_ms: timeoutMs ?? undefined,
          },
        })

        emitSubagentEvent({ type: 'started', id: task.id, description: task.description })
        if (task.name) emitSubagentEvent({ type: 'named', id: task.id, name: task.name })

        void (async () => {
          try {
            let timeoutTimer: NodeJS.Timeout | undefined
            if (task.timeoutMs) {
              timeoutTimer = setTimeout(() => {
                subagentTasks.update(task.id, { status: 'timeout', error: 'Timeout' })
                task.controller.abort()
              }, task.timeoutMs)
            }

            const report = await runSubagentSession({
              provider,
              model,
              system,
              chatHistory,
              tools,
              toolContext: subCtx,
              maxIterations: MAX_SUBAGENT_TOOL_ITERATIONS,
              onProgress: p => {
                if (p.type === 'tool_start') emitSubagentEvent({ type: 'progress', id: task.id, message: `tool_start ${p.toolName}` })
                if (p.type === 'tool_done') emitSubagentEvent({ type: 'progress', id: task.id, message: `tool_done ${p.toolName}` })
              },
              signal: task.controller.signal,
              drainIncomingMessages: () => subagentTasks.drainMessages(task.id),
            })
            if (timeoutTimer) clearTimeout(timeoutTimer)
            subagentTasks.update(task.id, { status: 'completed', report })
            emitSubagentEvent({ type: 'completed', id: task.id, report })
          } catch (err: unknown) {
            const e = err as Error
            subagentTasks.update(task.id, { status: 'failed', error: e.message })
            emitSubagentEvent({ type: 'failed', id: task.id, error: e.message })
          }
        })()

        return { content: `Task started: ${task.id}` }
      }

      const report = await runSubagentSession({
        provider,
        model,
        system,
        chatHistory,
        tools,
        toolContext: subCtx,
        maxIterations: MAX_SUBAGENT_TOOL_ITERATIONS,
      })
      return { content: report }
    } catch (err: unknown) {
      const e = err as Error
      return { content: `Sub-agent failed: ${e.message}`, isError: true }
    }
  },
}

function getSubagentTools(subagentType: string): ToolDef[] {
  if (subagentType === 'coder') {
    return [FileReadTool, FileWriteTool, FileEditTool, GlobTool, GrepTool, ListDirTool]
  }
  if (subagentType === 'shell') {
    return [BashTool, FileReadTool, GlobTool, GrepTool, ListDirTool]
  }
  return [FileReadTool, GlobTool, GrepTool, ListDirTool]
}

function buildSubagentSystemPrompt(opts: { subagentType: string; description: string; responseLanguage: string }): string {
  const lang = opts.responseLanguage ? `Use ${opts.responseLanguage} for your final answer.` : 'Use the same language as the user.'
  const title = opts.description ? `Task: ${opts.description}` : 'Task'
  return `You are a sub-agent working for Guang Code.\n\n${title}\n\nGuidelines:\n- Focus only on the given task.\n- Be concise and factual.\n- If you use tools, use them efficiently.\n- Return a final report only.\n\nLanguage:\n- ${lang}\n`
}

function buildSubagentUserPrompt(opts: { description: string; query: string }): string {
  if (opts.description) {
    return `Description: ${opts.description}\n\nTask:\n${opts.query}`
  }
  return `Task:\n${opts.query}`
}

function parseToolList(v: unknown): string[] | null {
  if (!v) return null
  const raw = v.toString().trim()
  if (!raw) return null
  return raw.split(',').map(s => s.trim()).filter(Boolean)
}

function filterTools(tools: ToolDef[], allow: string[] | null, deny: string[] | null): ToolDef[] {
  let out = tools
  if (allow && allow.length > 0) {
    out = out.filter(t => allow.includes(t.name))
  }
  if (deny && deny.length > 0) {
    out = out.filter(t => !deny.includes(t.name))
  }
  return out
}
