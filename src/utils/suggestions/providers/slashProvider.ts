import type { Suggestion, SuggestionProvider, SuggestionsContext } from '../types.js'

function scoreSlash(q: string, name: string, desc: string): number {
  if (!q) return 1
  if (name === q) return 100
  if (name.startsWith(q)) return 60 - (name.length - q.length)
  if (name.includes(q)) return 40 - Math.max(0, name.indexOf(q))
  if (desc.includes(q)) return 20 - Math.max(0, desc.indexOf(q))
  return 0
}

export const slashProvider: SuggestionProvider = {
  id: 'slash',
  priority: 100,
  supports(ctx: SuggestionsContext) {
    const v = ctx.input
    if (!v.startsWith('/')) return false
    if (v.includes(' ')) return false
    return true
  },
  async getSuggestions(ctx: SuggestionsContext): Promise<Suggestion[]> {
    const v = ctx.input
    const q = v.slice(1).trim().toLowerCase()
    const scored = ctx.slashCommands.map(c => {
      const name = c.name.toLowerCase()
      const desc = (c.description ?? '').toLowerCase()
      const score = scoreSlash(q, name, desc)
      return { name: c.name, description: c.description, score }
    })
    const items = scored
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .slice(0, 8)
      .map((x): Suggestion => ({
        id: `slash:${x.name}`,
        providerId: 'slash',
        label: `/${x.name}  ${x.description ?? ''}`.trimEnd(),
        score: x.score,
        apply: () => `/${x.name} `,
      }))
    return items
  },
}

