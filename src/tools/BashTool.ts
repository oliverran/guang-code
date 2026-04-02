// ============================================================
//  Guang Code — BashTool
// ============================================================

import { spawn } from 'child_process'
import type { ToolDef, ToolContext, ToolResult } from '../types/index.js'

export const BashTool: ToolDef = {
  name: 'Bash',
  description:
    'Execute a shell command in the current working directory. Use for running tests, builds, git operations, installing packages, etc.',
  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to execute',
      },
      timeout: {
        type: 'number',
        description: 'Optional timeout in milliseconds (default: 30000)',
      },
      description: {
        type: 'string',
        description: 'Brief description of what this command does',
      },
    },
    required: ['command'],
  },

  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const command = input.command as string
    const timeout = (input.timeout as number | undefined) ?? 30000

    // plan mode: deny write-like commands
    if (ctx.permissionMode === 'plan') {
      const writeLike = /\b(rm|mv|cp|mkdir|touch|echo.*>|tee|write|dd|sed -i|awk.*>)\b/.test(command)
      if (writeLike) {
        return {
          content: 'Plan mode active: write operations are not allowed until the plan is approved.',
          isError: true,
        }
      }
    }

    try {
      const parsed = parseCommand(command)
      if (!parsed) {
        return { content: 'Unsupported command syntax. Use a simple executable + args (no pipes/redirection).', isError: true }
      }
      const { file, args } = parsed
      const res = await runSpawn({ file, args, cwd: ctx.cwd, timeoutMs: timeout })
      return { content: res || '(command completed with no output)' }
    } catch (err: unknown) {
      const e = err as Error
      return { content: e.message || 'Command failed', isError: true }
    }
  },
}

function parseCommand(command: string): { file: string; args: string[] } | null {
  const s = (command ?? '').toString().trim()
  if (!s) return null
  if (/[|&;<>`]/.test(s)) return null
  const tokens: string[] = []
  let cur = ''
  let quote: '"' | "'" | null = null
  for (let i = 0; i < s.length; i++) {
    const ch = s[i] ?? ''
    if (quote) {
      if (ch === quote) {
        quote = null
      } else {
        cur += ch
      }
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch as any
      continue
    }
    if (/\s/.test(ch)) {
      if (cur) tokens.push(cur), cur = ''
      continue
    }
    cur += ch
  }
  if (quote) return null
  if (cur) tokens.push(cur)
  if (tokens.length === 0) return null
  const [file, ...args] = tokens
  return file ? { file, args } : null
}

function runSpawn(opts: { file: string; args: string[]; cwd: string; timeoutMs: number }): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(opts.file, opts.args, {
      cwd: opts.cwd,
      env: { ...process.env },
      shell: false,
      windowsHide: true,
    })
    const chunks: string[] = []
    let totalChars = 0
    const MAX_CHARS = 1024 * 1024 * 4
    const onData = (b: Buffer) => {
      if (totalChars >= MAX_CHARS) return
      const s = b.toString('utf8')
      totalChars += s.length
      chunks.push(s)
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    const t = setTimeout(() => {
      child.kill()
      reject(new Error(`Command timed out after ${opts.timeoutMs}ms`))
    }, opts.timeoutMs)
    child.on('error', (e) => {
      clearTimeout(t)
      reject(e)
    })
    child.on('close', (code) => {
      clearTimeout(t)
      const out = chunks.join('').trim()
      if (code === 0) return resolve(out)
      reject(new Error(out || `Command failed with exit code ${code ?? 'unknown'}`))
    })
  })
}
