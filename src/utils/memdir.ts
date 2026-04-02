import fs from 'fs'
import path from 'path'
import { homedir } from 'os'
import { createHash, randomUUID } from 'crypto'
import { findSecrets, hasSecrets } from './secretScanner.js'

export type MemoryEntryType = 'user' | 'project' | 'reference' | 'feedback'

export type MemoryEntry = {
  id: string
  type: MemoryEntryType
  name: string
  description: string
  filePath: string
  createdAt: number
}

export const ENTRYPOINT_NAME = 'MEMORY.md'
export const MAX_ENTRYPOINT_LINES = 200
export const MAX_ENTRYPOINT_BYTES = 25000
const MAX_LINKED_FILES = 6
const MAX_LINKED_FILE_CHARS = 9000

export type EntrypointTruncation = {
  content: string
  lineCount: number
  byteCount: number
  wasLineTruncated: boolean
  wasByteTruncated: boolean
}

export const MEMORY_FRONTMATTER_EXAMPLE = [
  '---',
  'name: A short, descriptive name',
  'description: One line describing what this memory is for',
  'type: project',
  '---',
  '',
]

export type MemoryOptions = {
  enabled?: boolean
  baseDir?: string
}

function getAncestors(startDir: string): string[] {
  const out: string[] = []
  let cur = path.resolve(startDir)
  while (true) {
    out.push(cur)
    const parent = path.dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  return out
}

function findGitRoot(startDir: string): string | null {
  for (const dir of getAncestors(startDir)) {
    const dotgit = path.join(dir, '.git')
    if (fs.existsSync(dotgit)) return dir
  }
  return null
}

function sanitizeKey(s: string): string {
  const norm = s.replace(/\\/g, '/')
  const base = path.basename(s) || 'project'
  const hash = createHash('sha1').update(norm).digest('hex').slice(0, 10)
  return `${base}-${hash}`.replace(/[^a-zA-Z0-9._-]/g, '_')
}

export function isAutoMemoryEnabled(opts?: MemoryOptions): boolean {
  if (opts?.enabled === false) return false
  const env = process.env.GC_DISABLE_AUTO_MEMORY ?? ''
  if (env === '1' || env.toLowerCase() === 'true') return false
  return true
}

function resolveMemoryBaseDir(override?: string): string {
  const env = process.env.GC_MEMORY_DIR_OVERRIDE
  const base = (override && override.trim()) ? override.trim() : (env && env.trim()) ? env.trim() : path.join(homedir(), '.guang-code', 'memory')
  return path.resolve(base)
}

export function getProjectMemoryDir(cwd: string, opts?: { baseDir?: string }): string {
  const root = findGitRoot(cwd) ?? path.resolve(cwd)
  const key = sanitizeKey(root)
  const base = resolveMemoryBaseDir(opts?.baseDir)
  return path.join(base, 'projects', key, 'memory')
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

function safeRead(filePath: string): string | null {
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile()) return null
    const raw = fs.readFileSync(filePath, 'utf-8')
    return raw.trim() ? raw : null
  } catch {
    return null
  }
}

function truncateText(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s
  return s.slice(0, maxChars) + '\n\n[...truncated]\n'
}

export function truncateEntrypointContent(raw: string): EntrypointTruncation {
  const trimmed = raw.trim()
  const contentLines = trimmed.split('\n')
  const lineCount = contentLines.length
  const byteCount = trimmed.length

  const wasLineTruncated = lineCount > MAX_ENTRYPOINT_LINES
  const wasByteTruncated = byteCount > MAX_ENTRYPOINT_BYTES

  if (!wasLineTruncated && !wasByteTruncated) {
    return { content: trimmed, lineCount, byteCount, wasLineTruncated, wasByteTruncated }
  }

  let truncated = wasLineTruncated ? contentLines.slice(0, MAX_ENTRYPOINT_LINES).join('\n') : trimmed
  if (truncated.length > MAX_ENTRYPOINT_BYTES) {
    const cutAt = truncated.lastIndexOf('\n', MAX_ENTRYPOINT_BYTES)
    truncated = truncated.slice(0, cutAt > 0 ? cutAt : MAX_ENTRYPOINT_BYTES)
  }

  const reason =
    wasByteTruncated && !wasLineTruncated
      ? `${byteCount} chars (limit: ${MAX_ENTRYPOINT_BYTES})`
      : wasLineTruncated && !wasByteTruncated
        ? `${lineCount} lines (limit: ${MAX_ENTRYPOINT_LINES})`
        : `${lineCount} lines and ${byteCount} chars`

  return {
    content:
      truncated +
      `\n\n> WARNING: ${ENTRYPOINT_NAME} is ${reason}. Only part of it was loaded. Keep index entries to one line; move detail into topic files.`,
    lineCount,
    byteCount,
    wasLineTruncated,
    wasByteTruncated,
  }
}

function slugify(name: string): string {
  const t = name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  return t || 'memory'
}

function extractLinksFromIndex(markdown: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const re = /\[[^\]]+\]\(([^)]+)\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(markdown)) !== null) {
    const link = (m[1] ?? '').trim()
    if (!link) continue
    if (link.startsWith('http://') || link.startsWith('https://') || link.startsWith('file://')) continue
    const cleaned = link.replace(/^\.?\//, '')
    if (seen.has(cleaned)) continue
    seen.add(cleaned)
    out.push(cleaned)
    if (out.length >= MAX_LINKED_FILES) break
  }
  return out
}

function renderEntryFrontmatter(entry: { name: string; description: string; type: MemoryEntryType }): string {
  const lines = [
    '---',
    `name: ${entry.name.replace(/\n/g, ' ').trim()}`,
    `description: ${entry.description.replace(/\n/g, ' ').trim()}`,
    `type: ${entry.type}`,
    '---',
    '',
  ]
  return lines.join('\n')
}

function parseFrontmatterBlock(raw: string): { frontmatter: Record<string, string>; body: string } {
  const trimmed = raw
  if (!trimmed.startsWith('---')) return { frontmatter: {}, body: raw }
  const lines = raw.split('\n')
  if (lines.length < 3) return { frontmatter: {}, body: raw }
  if (lines[0].trim() !== '---') return { frontmatter: {}, body: raw }

  const fm: Record<string, string> = {}
  let i = 1
  for (; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (line.trim() === '---') { i++; break }
    const idx = line.indexOf(':')
    if (idx < 0) continue
    const key = line.slice(0, idx).trim()
    const val = line.slice(idx + 1).trim()
    if (!key) continue
    fm[key] = val
  }

  return { frontmatter: fm, body: lines.slice(i).join('\n') }
}

function readMemoryMetadata(filePath: string): { type?: MemoryEntryType; name?: string; description?: string; createdAt?: number } {
  const raw = safeRead(filePath)
  if (!raw) return {}
  const parsed = parseFrontmatterBlock(raw)
  const typeRaw = (parsed.frontmatter.type ?? '').toLowerCase()
  const type = (typeRaw === 'user' || typeRaw === 'project' || typeRaw === 'reference' || typeRaw === 'feedback')
    ? (typeRaw as MemoryEntryType)
    : undefined
  const name = parsed.frontmatter.name?.trim() || undefined
  const description = parsed.frontmatter.description?.trim() || undefined
  try {
    const st = fs.statSync(filePath)
    return { type, name, description, createdAt: st.mtimeMs }
  } catch {
    return { type, name, description }
  }
}

function writeTextAtomic(filePath: string, content: string): void {
  ensureDir(path.dirname(filePath))
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tmp, content, 'utf-8')
  try {
    fs.renameSync(tmp, filePath)
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException
    if (e.code === 'EEXIST' || e.code === 'EPERM') {
      try { fs.unlinkSync(filePath) } catch { }
      fs.renameSync(tmp, filePath)
      return
    }
    try { fs.unlinkSync(tmp) } catch { }
    throw err
  }
}

export function ensureMemoryDirExists(cwd: string, opts?: MemoryOptions): string {
  const dir = getProjectMemoryDir(cwd, { baseDir: opts?.baseDir })
  try {
    ensureDir(dir)
  } catch {
  }
  return dir
}

export function ensureMemoryIndexExists(cwd: string, opts?: MemoryOptions): { memoryDir: string; entrypoint: string } {
  const dir = ensureMemoryDirExists(cwd, { baseDir: opts?.baseDir })
  const entrypoint = path.join(dir, ENTRYPOINT_NAME)
  if (!fs.existsSync(entrypoint)) {
    const template =
      '# Memory index\n' +
      '\n' +
      'Add one line per topic:\n' +
      '- [Short title](topic-file.md) — one-line description\n'
    writeTextAtomic(entrypoint, template)
  }
  return { memoryDir: dir, entrypoint }
}

function buildMemoryGuidance(memoryDir: string): string {
  return [
    '## Memory',
    `Memory directory: ${memoryDir}`,
    '',
    'Write each memory to its own file using this frontmatter format:',
    '',
    ...MEMORY_FRONTMATTER_EXAMPLE,
    '- Keep each memory file focused on one topic',
    '- Update existing memories instead of duplicating',
    `- Keep ${ENTRYPOINT_NAME} as an index (one line per entry); put details in files`,
  ].join('\n')
}

export function loadMemoryForPrompt(cwd: string, opts?: MemoryOptions): { text: string; sources: string[]; memoryDir: string } | null {
  const enabled = isAutoMemoryEnabled(opts)
  if (!enabled) return null

  const dir = ensureMemoryDirExists(cwd, opts)
  const entrypoint = path.join(dir, ENTRYPOINT_NAME)

  const rawIndex = safeRead(entrypoint)
  const sources: string[] = []
  const blocks: string[] = []

  blocks.push(buildMemoryGuidance(dir))

  if (!rawIndex) {
    return { text: blocks.join('\n\n').trim(), sources, memoryDir: dir }
  }

  if (hasSecrets(rawIndex)) {
    blocks.push('[Memory index]\n[SKIPPED: potential secrets detected]\n[/Memory index]')
    return { text: blocks.join('\n\n').trim(), sources, memoryDir: dir }
  }

  sources.push(entrypoint)
  const trunc = truncateEntrypointContent(rawIndex)
  const indexText = trunc.content
  const links = extractLinksFromIndex(indexText)

  blocks.push(`[Memory index]\n${indexText}\n[/Memory index]`)

  for (const rel of links) {
    const fp = path.join(dir, rel)
    const body = safeRead(fp)
    if (!body) continue
    if (hasSecrets(body)) {
      blocks.push(`[Memory file: ${rel}]\n[SKIPPED: potential secrets detected]\n[/Memory file: ${rel}]`)
      continue
    }
    sources.push(fp)
    blocks.push(`[Memory file: ${rel}]\n${truncateText(body, MAX_LINKED_FILE_CHARS)}\n[/Memory file: ${rel}]`)
  }

  return { text: blocks.join('\n\n').trim(), sources, memoryDir: dir }
}

export function listMemoryEntries(cwd: string, opts?: MemoryOptions): MemoryEntry[] {
  const dir = getProjectMemoryDir(cwd, { baseDir: opts?.baseDir })
  const entrypoint = path.join(dir, ENTRYPOINT_NAME)
  const raw = safeRead(entrypoint)
  if (!raw) return []

  const lines = raw.split('\n').slice(0, MAX_ENTRYPOINT_LINES)
  const out: MemoryEntry[] = []
  const re = /^-\s+\[([^\]]+)\]\(([^)]+)\)\s*(?:—\s*(.*))?$/

  for (const line of lines) {
    const m = line.match(re)
    if (!m) continue
    const link = (m[2] ?? '').trim()
    const id = link.replace(/^\.?\//, '')
    const filePath = path.join(dir, id)
    const meta = readMemoryMetadata(filePath)
    const name = meta.name ?? (m[1] ?? '').trim()
    const description = meta.description ?? (m[3] ?? '').trim()
    out.push({ id, type: meta.type ?? 'project', name, description, filePath, createdAt: meta.createdAt ?? 0 })
  }

  return out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
}

export function addMemory(cwd: string, opts: { type: MemoryEntryType; name?: string; description?: string; body: string } & { baseDir?: string }): MemoryEntry {
  const dir = ensureMemoryDirExists(cwd, { baseDir: opts.baseDir })

  const bodyTrimmed = (opts.body ?? '').trim()
  const firstLine = bodyTrimmed.split('\n').find(Boolean) ?? ''
  const name = (opts.name && opts.name.trim()) ? opts.name.trim() : firstLine.slice(0, 80) || 'Memory'
  const description = (opts.description && opts.description.trim()) ? opts.description.trim() : ''
  const type = opts.type

  const slug = slugify(name)
  const id = `${slug}-${randomUUID().slice(0, 8)}.md`
  const filePath = path.join(dir, id)

  const content = renderEntryFrontmatter({ name, description, type }) + bodyTrimmed + '\n'
  const findings = findSecrets(content, 5)
  if (findings.length > 0) {
    const kinds = Array.from(new Set(findings.map(f => f.kind))).join(', ')
    throw new Error(`Potential secrets detected in memory content (${kinds}). Refusing to save.`)
  }
  writeTextAtomic(filePath, content)

  const entrypoint = path.join(dir, ENTRYPOINT_NAME)
  const indexLine = `- [${name}](${id})${description ? ` — ${description}` : ''}`
  const prevIndex = safeRead(entrypoint)
  const nextIndex = prevIndex ? `${indexLine}\n${prevIndex.trim()}\n` : `${indexLine}\n`
  writeTextAtomic(entrypoint, nextIndex)

  return { id, type, name, description, filePath, createdAt: Date.now() }
}

export function removeMemory(cwd: string, id: string, opts?: MemoryOptions): { ok: boolean; error?: string } {
  const dir = getProjectMemoryDir(cwd, { baseDir: opts?.baseDir })
  const entrypoint = path.join(dir, ENTRYPOINT_NAME)
  const fp = path.join(dir, id)

  try {
    if (fs.existsSync(fp)) fs.unlinkSync(fp)
  } catch (err: unknown) {
    return { ok: false, error: (err as Error).message }
  }

  const raw = safeRead(entrypoint)
  if (!raw) return { ok: true }

  const lines = raw.split('\n')
  const kept = lines.filter(l => !l.includes(`](${id})`))
  try {
    fs.writeFileSync(entrypoint, kept.join('\n').trim() + '\n', 'utf-8')
    return { ok: true }
  } catch (err: unknown) {
    return { ok: false, error: (err as Error).message }
  }
}

export function readMemoryFile(cwd: string, id: string, opts?: MemoryOptions): string | null {
  const dir = getProjectMemoryDir(cwd, { baseDir: opts?.baseDir })
  const fp = path.join(dir, id)
  return safeRead(fp)
}
