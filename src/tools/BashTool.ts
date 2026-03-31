// ============================================================
//  Guang Code — BashTool
// ============================================================

import { exec } from 'child_process'
import { promisify } from 'util'
import type { ToolDef, ToolContext, ToolResult } from '../types/index.js'

const execAsync = promisify(exec)

// Commands that require explicit user confirmation even in auto mode
const DANGEROUS_PATTERNS = [
  /rm\s+-rf?\s+[/~]/,
  /rm\s+-rf\s/,
  /\bdd\b/,
  /\bmkfs\b/,
  /\bfdisk\b/,
  /\bformat\b/,
  />\s*\/dev\//,
  /:\(\)\{.*\}/,        // fork bomb
  /curl.*\|\s*(ba)?sh/, // curl pipe to shell
  /wget.*\|\s*(ba)?sh/,
]

function isDangerous(command: string): boolean {
  return DANGEROUS_PATTERNS.some(p => p.test(command))
}

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
    const description = (input.description as string | undefined) ?? command

    // Permission check
    if (ctx.permissionMode !== 'auto' || isDangerous(command)) {
      const approved = await ctx.onPermissionRequest(
        'Bash',
        `Run command: ${description}\n\`${command}\``,
      )
      if (!approved) {
        return { content: 'Command execution was denied by user.', isError: true }
      }
    }

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
      const { stdout, stderr } = await execAsync(command, {
        cwd: ctx.cwd,
        timeout,
        maxBuffer: 1024 * 1024 * 4, // 4MB
        env: { ...process.env },
      })
      const out = [stdout, stderr].filter(Boolean).join('\n').trim()
      return { content: out || '(command completed with no output)' }
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; killed?: boolean }
      if (e.killed) {
        return { content: `Command timed out after ${timeout}ms`, isError: true }
      }
      const output = [e.stdout, e.stderr, e.message].filter(Boolean).join('\n')
      return { content: output || 'Command failed', isError: true }
    }
  },
}
