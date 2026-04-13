import type { Suggestion, SuggestionProvider, SuggestionsContext } from '../types.js'
import { lastToken, replaceLastToken } from '../utils.js'
import { isGitRepo, listGitBranches } from '../../git.js'

type BranchCache = { at: number; cwd: string; branches: string[] }
let cache: BranchCache | null = null

function parseGitCheckoutPrefix(input: string): { ok: boolean; prefix: string } {
  const m = input.match(/^git\s+(checkout|switch)\s*(.*)$/)
  if (!m) return { ok: false, prefix: '' }
  const token = lastToken(input)
  return { ok: true, prefix: token }
}

export const gitBranchProvider: SuggestionProvider = {
  id: 'git-branch',
  priority: 50,
  supports(ctx: SuggestionsContext) {
    if (ctx.input.startsWith('/')) return false
    const parsed = parseGitCheckoutPrefix(ctx.input.trim())
    if (!parsed.ok) return false
    if (!parsed.prefix) return true
    if (parsed.prefix.startsWith('-')) return false
    return true
  },
  async getSuggestions(ctx: SuggestionsContext): Promise<Suggestion[]> {
    const parsed = parseGitCheckoutPrefix(ctx.input.trim())
    if (!parsed.ok) return []
    const okRepo = await isGitRepo(ctx.cwd)
    if (!okRepo) return []

    const now = Date.now()
    const ttlMs = 5_000
    if (!cache || cache.cwd !== ctx.cwd || now - cache.at > ttlMs) {
      const branches = await listGitBranches(ctx.cwd)
      cache = { at: now, cwd: ctx.cwd, branches }
    }

    const q = (parsed.prefix ?? '').toLowerCase()
    const matches = cache.branches
      .filter(b => (q ? b.toLowerCase().startsWith(q) : true))
      .slice(0, 8)

    return matches.map((b, idx): Suggestion => ({
      id: `git-branch:${b}`,
      providerId: 'git-branch',
      label: b,
      score: 65 - idx,
      apply: (input: string) => replaceLastToken(input, b),
    }))
  },
}
