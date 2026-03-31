// ============================================================
//  Guang Code — GrepTool
// ============================================================

import { exec } from 'child_process'
import { promisify } from 'util'
import type { ToolDef, ToolContext, ToolResult } from '../types/index.js'

const execAsync = promisify(exec)

export const GrepTool: ToolDef = {
  name: 'Grep',
  description:
    'Search for a pattern in files using grep (or ripgrep if available). Returns file paths with matching lines. Use for finding function definitions, variable usage, TODO comments, etc.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Regular expression pattern to search for',
      },
      include: {
        type: 'string',
        description: 'File glob filter (e.g. "*.ts" or "*.{ts,tsx}")',
      },
      path: {
        type: 'string',
        description: 'Directory to search in (defaults to current working directory)',
      },
      context_lines: {
        type: 'number',
        description: 'Number of context lines to show around each match (default: 2)',
      },
    },
    required: ['pattern'],
  },

  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const pattern = input.pattern as string
    const include = input.include as string | undefined
    const searchPath = (input.path as string | undefined) ?? '.'
    const contextLines = (input.context_lines as number | undefined) ?? 2

    // Try ripgrep first, fall back to grep
    const hasRg = await checkRipgrep()

    let command: string
    if (hasRg) {
      const includeFlag = include ? `--glob "${include}"` : ''
      command = `rg --line-number --context ${contextLines} --color never ${includeFlag} "${pattern.replace(/"/g, '\\"')}" "${searchPath}"`
    } else {
      const includeFlag = include ? `--include="${include}"` : ''
      command = `grep -rn --context=${contextLines} ${includeFlag} "${pattern.replace(/"/g, '\\"')}" "${searchPath}" 2>/dev/null || true`
    }

    try {
      const { stdout } = await execAsync(command, {
        cwd: ctx.cwd,
        maxBuffer: 1024 * 512, // 512KB
        timeout: 15000,
      })

      const trimmed = stdout.trim()
      if (!trimmed) {
        return { content: `No matches found for pattern: ${pattern}` }
      }

      // Limit output
      const lines = trimmed.split('\n')
      const MAX = 200
      const shown = lines.slice(0, MAX)
      const suffix = lines.length > MAX ? `\n... (${lines.length - MAX} more lines truncated)` : ''

      return { content: shown.join('\n') + suffix }
    } catch (err: unknown) {
      const e = err as Error
      return { content: `Grep error: ${e.message}`, isError: true }
    }
  },
}

let _hasRg: boolean | null = null
async function checkRipgrep(): Promise<boolean> {
  if (_hasRg !== null) return _hasRg
  try {
    await execAsync('rg --version', { timeout: 2000 })
    _hasRg = true
  } catch {
    _hasRg = false
  }
  return _hasRg
}
