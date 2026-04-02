// ============================================================
//  Guang Code — FileWriteTool
// ============================================================

import { writeFile, mkdir } from 'fs/promises'
import { dirname } from 'path'
import { assertSafeLocalPath, resolveRealPathWithinCwd } from '../utils/pathSafety.js'
import type { ToolDef, ToolContext, ToolResult } from '../types/index.js'

export const FileWriteTool: ToolDef = {
  name: 'Write',
  description:
    'Create or overwrite a file with the given content. Creates parent directories if needed. Use for creating new files or completely replacing file contents.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Absolute or relative path to the file to write',
      },
      content: {
        type: 'string',
        description: 'The full content to write to the file',
      },
    },
    required: ['file_path', 'content'],
  },

  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    let filePath = ''
    const content = input.content as string

    if (ctx.permissionMode === 'plan') {
      return {
        content: 'Plan mode active: file writes are not allowed until the plan is approved.',
        isError: true,
      }
    }

    try {
      filePath = assertSafeLocalPath({ cwd: ctx.cwd, inputPath: String(input.file_path ?? '') })
      await resolveRealPathWithinCwd({ cwd: ctx.cwd, absPath: filePath })
      await mkdir(dirname(filePath), { recursive: true })
      await writeFile(filePath, content, 'utf-8')
      const lines = content.split('\n').length
      return { content: `File written successfully: ${filePath} (${lines} lines)` }
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException
      return { content: `Failed to write file: ${e.message}`, isError: true }
    }
  },
}
