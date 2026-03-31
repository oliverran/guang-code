// ============================================================
//  Guang Code — ListDirTool
// ============================================================

import { readdir, stat } from 'fs/promises'
import { resolve, join } from 'path'
import type { ToolDef, ToolContext, ToolResult } from '../types/index.js'

export const ListDirTool: ToolDef = {
  name: 'LS',
  description:
    'List files and directories in a given path. Shows file sizes and types. Use before reading or editing files to understand the project structure.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Directory path to list (defaults to current working directory)',
      },
      show_hidden: {
        type: 'string',
        description: 'Whether to show hidden files (true/false)',
        enum: ['true', 'false'],
        default: 'false',
      },
    },
    required: [],
  },

  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const targetPath = resolve(ctx.cwd, (input.path as string | undefined) ?? '.')
    const showHidden = (input.show_hidden as string | undefined) === 'true'

    try {
      const entries = await readdir(targetPath, { withFileTypes: true })
      const filtered = showHidden ? entries : entries.filter(e => !e.name.startsWith('.'))

      if (filtered.length === 0) {
        return { content: `Directory is empty: ${targetPath}` }
      }

      const lines: string[] = []
      for (const entry of filtered) {
        const fullPath = join(targetPath, entry.name)
        if (entry.isDirectory()) {
          lines.push(`📁  ${entry.name}/`)
        } else {
          try {
            const s = await stat(fullPath)
            const size = formatSize(s.size)
            lines.push(`📄  ${entry.name}  (${size})`)
          } catch {
            lines.push(`📄  ${entry.name}`)
          }
        }
      }

      return {
        content: `Directory: ${targetPath}\n${lines.join('\n')}`,
      }
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException
      if (e.code === 'ENOENT') {
        return { content: `Directory not found: ${targetPath}`, isError: true }
      }
      return { content: `Failed to list directory: ${e.message}`, isError: true }
    }
  },
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}
