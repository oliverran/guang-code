export type Suggestion = {
  id: string
  providerId: string
  label: string
  score: number
  apply: (input: string) => string
}

export type SuggestionsContext = {
  cwd: string
  input: string
  inputHistory: string[]
  slashCommands: { name: string; description?: string }[]
}

export type SuggestionProvider = {
  id: string
  priority: number
  supports: (ctx: SuggestionsContext) => boolean
  getSuggestions: (ctx: SuggestionsContext) => Promise<Suggestion[]>
}

