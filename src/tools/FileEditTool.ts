// ============================================================
//  Guang Code — FileEditTool
//  Precise string replacement (like Claude Code's FileEditTool)
// ============================================================

import { readFile, writeFile } from 'fs/promises'
import { resolve } from 'path'
import type { ToolDef, ToolContext, ToolResult } from '../types/index.js'

export const FileEditTool: ToolDef = {
  name: 'Edit',
  description: `Edit a file by replacing a specific string with a new string. The old_string must match EXACTLY (including all whitespace and indentation). Use Read tool first to get the exact content. Prefer this over Write for small targeted changes.`,
  inputSchema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Path to the file to edit',
      },
      old_string: {
        type: 'string',
        description: 'The exact string to find and replace (must be unique in the file)',
      },
      new_string: {
        type: 'string',
        description: 'The string to replace old_string with',
      },
    },
    required: ['file_path', 'old_string', 'new_string'],
  },

  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const filePath = resolve(ctx.cwd, input.file_path as string)
    const oldString = input.old_string as string
    const newString = input.new_string as string

    // Permission check
    const approved = await ctx.onPermissionRequest(
      'Edit',
      `Edit file: ${filePath}\n- Replace ${oldString.split('\n').length}-line block`,
    )
    if (!approved) {
      return { content: 'File edit was denied by user.', isError: true }
    }

    if (ctx.permissionMode === 'plan') {
      return {
        content: 'Plan mode active: file edits are not allowed until the plan is approved.',
        isError: true,
      }
    }

    try {
      const raw = await readFile(filePath, 'utf-8')

      const occurrences = raw.split(oldString).length - 1
      if (occurrences === 0) {
        return {
          content: `old_string not found in ${filePath}. Make sure to read the file first and use the exact text.`,
          isError: true,
        }
      }
      if (occurrences > 1) {
        return {
          content: `old_string appears ${occurrences} times in ${filePath}. Please provide more context to make it unique.`,
          isError: true,
        }
      }

      const updated = raw.replace(oldString, newString)
      await writeFile(filePath, updated, 'utf-8')

      const oldLines = oldString.split('\n').length
      const newLines = newString.split('\n').length
      return {
        content: `File edited successfully: ${filePath}\nReplaced ${oldLines} lines → ${newLines} lines`,
      }
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException
      if (e.code === 'ENOENT') {
        return { content: `File not found: ${filePath}`, isError: true }
      }
      return { content: `Failed to edit file: ${e.message}`, isError: true }
    }
  },
}
