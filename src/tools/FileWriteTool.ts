// ============================================================
//  Guang Code — FileWriteTool
// ============================================================

import { writeFile, mkdir } from 'fs/promises'
import { resolve, dirname } from 'path'
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
    const filePath = resolve(ctx.cwd, input.file_path as string)
    const content = input.content as string

    // Always require permission for file writes
    const approved = await ctx.onPermissionRequest(
      'Write',
      `Create/overwrite file: ${filePath}\n(${content.split('\n').length} lines)`,
    )
    if (!approved) {
      return { content: 'File write was denied by user.', isError: true }
    }

    if (ctx.permissionMode === 'plan') {
      return {
        content: 'Plan mode active: file writes are not allowed until the plan is approved.',
        isError: true,
      }
    }

    try {
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
