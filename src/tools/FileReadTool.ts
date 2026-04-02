// ============================================================
//  Guang Code — FileReadTool
// ============================================================

import { readFile, stat } from 'fs/promises'
import { assertSafeLocalPath, isLikelyTextFileExt, resolveRealPathWithinCwd } from '../utils/pathSafety.js'
import type { ToolDef, ToolContext, ToolResult } from '../types/index.js'

const MAX_FILE_SIZE = 1024 * 1024 // 1 MB

export const FileReadTool: ToolDef = {
  name: 'Read',
  description:
    'Read the contents of a file. Supports text files, code files, JSON, Markdown, etc. Returns the file content with line numbers.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Absolute or relative path to the file to read',
      },
      start_line: {
        type: 'number',
        description: 'Start reading from this line number (1-indexed, optional)',
      },
      end_line: {
        type: 'number',
        description: 'Stop reading at this line number inclusive (optional)',
      },
    },
    required: ['file_path'],
  },

  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    let filePath = ''
    const startLine = (input.start_line as number | undefined) ?? 1
    const endLine = input.end_line as number | undefined

    try {
      filePath = assertSafeLocalPath({ cwd: ctx.cwd, inputPath: String(input.file_path ?? '') })
      if (!isLikelyTextFileExt(filePath)) {
        return { content: `Binary or unsupported file type: ${filePath}`, isError: true }
      }
      await resolveRealPathWithinCwd({ cwd: ctx.cwd, absPath: filePath })
      const stats = await stat(filePath)
      if (stats.size > MAX_FILE_SIZE) {
        return {
          content: `File too large (${(stats.size / 1024).toFixed(1)} KB). Use start_line/end_line to read specific sections.`,
          isError: true,
        }
      }

      const raw = await readFile(filePath, 'utf-8')
      const lines = raw.split('\n')
      const total = lines.length

      const from = Math.max(1, startLine) - 1
      const to = endLine !== undefined ? Math.min(endLine, total) : total

      const selected = lines.slice(from, to)
      const numbered = selected
        .map((line, i) => `${String(from + i + 1).padStart(4)} | ${line}`)
        .join('\n')

      return {
        content: `File: ${filePath}\nLines ${from + 1}-${to} of ${total}\n\n${numbered}`,
      }
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException
      if (e.code === 'ENOENT') {
        return { content: `File not found: ${filePath}`, isError: true }
      }
      return { content: `Failed to read file: ${e.message}`, isError: true }
    }
  },
}
