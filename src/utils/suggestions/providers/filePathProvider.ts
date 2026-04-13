import path from 'path'
import { readdir } from 'fs/promises'
import type { Suggestion, SuggestionProvider, SuggestionsContext } from '../types.js'
import { replaceLastToken, lastToken } from '../utils.js'
import { assertSafeLocalPath, resolveRealPathWithinCwd } from '../../pathSafety.js'

type CacheEntry = { at: number; dir: string; entries: { name: string; isDir: boolean }[] }
const dirCache = new Map<string, CacheEntry>()

function isPathLikeToken(token: string): boolean {
  if (!token) return false
  if (token.includes('/') || token.includes('\\')) return true
  if (token.startsWith('.')) return true
  return false
}

function hasParentTraversal(token: string): boolean {
  return /(^|[\\/])\.\.([\\/]|$)/.test(token)
}

export const filePathProvider: SuggestionProvider = {
  id: 'files',
  priority: 40,
  supports(ctx: SuggestionsContext) {
    if (ctx.input.startsWith('/')) return false
    const token = lastToken(ctx.input)
    if (!isPathLikeToken(token)) return false
    if (hasParentTraversal(token)) return false
    if (path.isAbsolute(token)) return false
    return true
  },
  async getSuggestions(ctx: SuggestionsContext): Promise<Suggestion[]> {
    const token = lastToken(ctx.input)
    if (!token) return []
    const sep = token.includes('\\') ? '\\' : '/'
    const normalized = token.replace(/\\/g, '/')
    const endsWithSep = normalized.endsWith('/')
    const dirPartRaw = endsWithSep ? normalized : path.posix.dirname(normalized)
    const namePart = endsWithSep ? '' : path.posix.basename(normalized)

    const preserveDot = normalized.startsWith('./')
    const dirPart = dirPartRaw === '.'
      ? (preserveDot ? '.' : '')
      : dirPartRaw
    const absDir = assertSafeLocalPath({ cwd: ctx.cwd, inputPath: dirPart || '.' })
    await resolveRealPathWithinCwd({ cwd: ctx.cwd, absPath: absDir })

    const cacheKey = `${ctx.cwd}::${absDir}`
    const now = Date.now()
    const cached = dirCache.get(cacheKey)
    const ttlMs = 2_000

    let entries: { name: string; isDir: boolean }[]
    if (cached && now - cached.at < ttlMs) {
      entries = cached.entries
    } else {
      const dirents = await readdir(absDir, { withFileTypes: true })
      entries = dirents.map(d => ({ name: d.name, isDir: d.isDirectory() }))
      dirCache.set(cacheKey, { at: now, dir: absDir, entries })
    }

    const q = namePart.toLowerCase()
    const filtered = entries
      .filter(e => (q ? e.name.toLowerCase().startsWith(q) : true))
      .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name))
      .slice(0, 8)

    return filtered.map((e, idx): Suggestion => {
      const replaced = `${dirPart ? dirPart + sep : ''}${e.name}${e.isDir ? sep : ''}`
      return {
        id: `files:${dirPart}:${e.name}`,
        providerId: 'files',
        label: replaced,
        score: 55 - idx,
        apply: (input: string) => replaceLastToken(input, replaced),
      }
    })
  },
}
