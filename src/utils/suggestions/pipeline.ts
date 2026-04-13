import type { Suggestion, SuggestionProvider, SuggestionsContext } from './types.js'
import { slashProvider } from './providers/slashProvider.js'
import { gitBranchProvider } from './providers/gitBranchProvider.js'
import { filePathProvider } from './providers/filePathProvider.js'
import { historyProvider } from './providers/historyProvider.js'

export type SuggestionsResult = {
  key: string
  items: Suggestion[]
}

const providers: SuggestionProvider[] = [
  slashProvider,
  gitBranchProvider,
  filePathProvider,
  historyProvider,
]

export async function getSuggestions(ctx: SuggestionsContext): Promise<SuggestionsResult> {
  const key = `${ctx.cwd}::${ctx.input}`
  const applicable = providers.filter(p => p.supports(ctx))
  if (applicable.length === 0) return { key, items: [] }

  const results = await Promise.allSettled(applicable.map(p => p.getSuggestions(ctx)))
  const collected: Suggestion[] = []
  for (const r of results) {
    if (r.status === 'fulfilled') collected.push(...r.value)
  }

  const sorted = collected
    .sort((a, b) => b.score - a.score || a.providerId.localeCompare(b.providerId) || a.label.localeCompare(b.label))
    .slice(0, 8)

  return { key, items: sorted }
}

