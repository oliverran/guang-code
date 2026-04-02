// ============================================================
//  Guang Code — GlobTool
// ============================================================

import { glob } from 'glob'
import type { ToolDef, ToolContext, ToolResult } from '../types/index.js'
import { validateGlobPattern } from '../utils/pathSafety.js'

export const GlobTool: ToolDef = {
  name: 'Glob',
  description:
    'Find files matching a glob pattern (e.g. "**/*.ts", "src/**/*.{js,ts}", "*.json"). Returns a list of matching file paths sorted by modification time.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Glob pattern to match (e.g. "**/*.ts")',
      },
      ignore: {
        type: 'string',
        description: 'Comma-separated glob patterns to ignore (e.g. "node_modules/**,dist/**")',
      },
    },
    required: ['pattern'],
  },

  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const pattern = input.pattern as string
    const ignoreRaw = input.ignore as string | undefined

    const v = validateGlobPattern(pattern)
    if (!v.ok) return { content: `Glob error: ${v.reason ?? 'Invalid pattern.'}`, isError: true }

    const ignorePatterns = ignoreRaw
      ? ignoreRaw.split(',').map(p => p.trim()).filter(Boolean)
      : ['node_modules/**', 'dist/**', '.git/**', '*.min.js']

    try {
      const matches = await glob(pattern, {
        cwd: ctx.cwd,
        ignore: ignorePatterns,
        absolute: false,
        dot: false,
      })

      if (matches.length === 0) {
        return { content: `No files matched pattern: ${pattern}` }
      }

      matches.sort()
      const result = matches.join('\n')
      return { content: `Found ${matches.length} file(s):\n${result}` }
    } catch (err: unknown) {
      const e = err as Error
      return { content: `Glob error: ${e.message}`, isError: true }
    }
  },
}
