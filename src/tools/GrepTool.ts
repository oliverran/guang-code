// ============================================================
//  Guang Code — GrepTool
// ============================================================

import { execFile } from 'child_process'
import { readFile, stat } from 'fs/promises'
import { glob } from 'glob'
import { promisify } from 'util'
import type { ToolDef, ToolContext, ToolResult } from '../types/index.js'
import { assertSafeLocalPath, validateGlobPattern } from '../utils/pathSafety.js'

const execFileAsync = promisify(execFile)

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

    try {
      const dir = assertSafeLocalPath({ cwd: ctx.cwd, inputPath: searchPath })
      if (include) {
        const v = validateGlobPattern(include)
        if (!v.ok) return { content: `Grep error: ${v.reason ?? 'Invalid include glob.'}`, isError: true }
      }

      const hasRg = await checkRipgrep()
      if (hasRg) {
        const args = ['--line-number', '--context', String(contextLines), '--color', 'never']
        if (include) args.push('--glob', include)
        args.push(pattern, dir)
        const { stdout } = await execFileAsync('rg', args, { cwd: ctx.cwd, maxBuffer: 1024 * 512, timeout: 15000 })
        return formatGrepOutput(pattern, stdout)
      }

      const out = await grepInJs({ dir, include, pattern, contextLines })
      return formatGrepOutput(pattern, out)
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
    await execFileAsync('rg', ['--version'], { timeout: 2000 })
    _hasRg = true
  } catch {
    _hasRg = false
  }
  return _hasRg
}

function formatGrepOutput(pattern: string, stdout: string): ToolResult {
  const trimmed = (stdout ?? '').trim()
  if (!trimmed) return { content: `No matches found for pattern: ${pattern}` }
  const lines = trimmed.split('\n')
  const MAX = 200
  const shown = lines.slice(0, MAX)
  const suffix = lines.length > MAX ? `\n... (${lines.length - MAX} more lines truncated)` : ''
  return { content: shown.join('\n') + suffix }
}

async function grepInJs(opts: { dir: string; include?: string; pattern: string; contextLines: number }): Promise<string> {
  const re = new RegExp(opts.pattern, 'g')
  const ignore = ['node_modules/**', 'dist/**', '.git/**']
  const globPattern = opts.include ? opts.include : '**/*'
  const files = await glob(globPattern, { cwd: opts.dir, absolute: true, nodir: true, dot: false, ignore })
  const MAX_FILES = 4000
  const targetFiles = files.slice(0, MAX_FILES)
  const linesOut: string[] = []
  const MAX_TOTAL_LINES = 2000
  for (const fp of targetFiles) {
    if (linesOut.length >= MAX_TOTAL_LINES) break
    try {
      const st = await stat(fp)
      if (st.size > 1024 * 1024) continue
      const raw = await readFile(fp, 'utf8')
      const lines = raw.split('\n')
      for (let idx = 0; idx < lines.length; idx++) {
        if (linesOut.length >= MAX_TOTAL_LINES) break
        const line = lines[idx] ?? ''
        re.lastIndex = 0
        if (!re.test(line)) continue
        const from = Math.max(0, idx - opts.contextLines)
        const to = Math.min(lines.length - 1, idx + opts.contextLines)
        for (let j = from; j <= to; j++) {
          const prefix = j === idx ? '>' : ' '
          linesOut.push(`${fp}:${j + 1}:${prefix}${lines[j] ?? ''}`)
        }
        linesOut.push('')
      }
    } catch {
    }
  }
  return linesOut.join('\n')
}
