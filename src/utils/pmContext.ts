import { createHash } from 'crypto'
import { mkdir, readFile, stat, writeFile } from 'fs/promises'
import path from 'path'
import { glob } from 'glob'
import { assertSafeLocalPath, isLikelyTextFileExt, resolveRealPathWithinCwd } from './pathSafety.js'

export type PmIngestedFile = {
  path: string
  sha256: string
  mtimeMs: number
  size: number
  excerpt: string
}

export type PmContext = {
  version: 1
  updatedAt: number
  files: PmIngestedFile[]
}

function pmDir(cwd: string): string {
  return path.join(cwd, '.guang', 'pm')
}

function contextPath(cwd: string): string {
  return path.join(pmDir(cwd), 'context.json')
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

export async function loadPmContext(cwd: string): Promise<PmContext> {
  try {
    const raw = await readFile(contextPath(cwd), 'utf-8')
    const parsed = JSON.parse(raw) as PmContext
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.files)) {
      return { version: 1, updatedAt: 0, files: [] }
    }
    return parsed
  } catch {
    return { version: 1, updatedAt: 0, files: [] }
  }
}

export async function savePmContext(cwd: string, ctx: PmContext): Promise<void> {
  await mkdir(pmDir(cwd), { recursive: true })
  await writeFile(contextPath(cwd), JSON.stringify(ctx, null, 2), 'utf-8')
}

export async function clearPmContext(cwd: string): Promise<void> {
  await savePmContext(cwd, { version: 1, updatedAt: Date.now(), files: [] })
}

async function ingestOneFile(cwd: string, relOrAbs: string): Promise<PmIngestedFile | null> {
  const abs = assertSafeLocalPath({ cwd, inputPath: relOrAbs })
  await resolveRealPathWithinCwd({ cwd, absPath: abs })
  if (!isLikelyTextFileExt(abs)) return null
  const st = await stat(abs)
  if (!st.isFile()) return null
  if (st.size > 1024 * 1024) return null
  const raw = await readFile(abs, 'utf-8')
  const excerpt = raw.length > 12000 ? raw.slice(0, 12000) + '\n…' : raw
  const rel = path.relative(cwd, abs).replace(/\\/g, '/')
  return {
    path: rel,
    sha256: sha256Hex(raw),
    mtimeMs: st.mtimeMs,
    size: st.size,
    excerpt,
  }
}

export async function ingestPmFiles(opts: {
  cwd: string
  patternsOrPaths: string[]
  ignore?: string[]
  maxFiles?: number
}): Promise<{ added: number; skipped: number; total: number }> {
  const cwd = opts.cwd
  const ignore = opts.ignore ?? ['node_modules/**', 'dist/**', '.git/**', '.guang/**']
  const maxFiles = opts.maxFiles ?? 50

  const ctx = await loadPmContext(cwd)
  const byPath = new Map(ctx.files.map(f => [f.path, f]))
  let added = 0
  let skipped = 0

  const candidates: string[] = []
  for (const p of opts.patternsOrPaths) {
    const v = (p ?? '').trim()
    if (!v) continue
    if (v.includes('*') || v.includes('?') || v.includes('[')) {
      const matches = await glob(v, { cwd, ignore, absolute: false, dot: false })
      for (const m of matches) candidates.push(m)
    } else {
      candidates.push(v)
    }
  }

  const seen = new Set<string>()
  const deduped = candidates.map(s => s.trim()).filter(Boolean).filter(s => {
    if (seen.has(s)) return false
    seen.add(s)
    return true
  })

  for (const p of deduped.slice(0, maxFiles)) {
    try {
      const ing = await ingestOneFile(cwd, p)
      if (!ing) {
        skipped++
        continue
      }
      const prev = byPath.get(ing.path)
      if (prev && prev.sha256 === ing.sha256) {
        skipped++
        continue
      }
      byPath.set(ing.path, ing)
      added++
    } catch {
      skipped++
    }
  }

  const next: PmContext = {
    version: 1,
    updatedAt: Date.now(),
    files: Array.from(byPath.values()).sort((a, b) => a.path.localeCompare(b.path)),
  }
  await savePmContext(cwd, next)
  return { added, skipped, total: next.files.length }
}

export function renderPmContextForPrompt(ctx: PmContext, maxChars = 60000): string {
  const parts: string[] = []
  let used = 0
  for (const f of ctx.files) {
    const header = `\n[FILE] ${f.path} (${Math.round(f.size / 1024)}KB)\n`
    const body = f.excerpt + '\n'
    const chunk = header + body
    if (used + chunk.length > maxChars) break
    parts.push(chunk)
    used += chunk.length
  }
  return parts.length ? parts.join('') : '[No ingested files]'
}

