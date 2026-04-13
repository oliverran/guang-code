import type { Suggestion, SuggestionProvider, SuggestionsContext } from '../types.js'

export const historyProvider: SuggestionProvider = {
  id: 'history',
  priority: 10,
  supports(ctx: SuggestionsContext) {
    const v = ctx.input.trim()
    if (!v) return false
    if (ctx.input.startsWith('/')) return false
    return true
  },
  async getSuggestions(ctx: SuggestionsContext): Promise<Suggestion[]> {
    const q = ctx.input
    const seen = new Set<string>()
    const matches = [...ctx.inputHistory]
      .reverse()
      .filter(s => s.startsWith(q) && s !== q)
      .filter(s => (seen.has(s) ? false : (seen.add(s), true)))
      .slice(0, 8)
    return matches.map((m, idx): Suggestion => ({
      id: `history:${idx}`,
      providerId: 'history',
      label: m,
      score: 30 - idx,
      apply: () => m,
    }))
  },
}

