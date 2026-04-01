import type { OutputStyle } from '../types/index.js'

export function getOutputStylePrompt(style: OutputStyle | undefined): { name: OutputStyle; prompt: string } {
  const s: OutputStyle = style ?? 'default'

  if (s === 'explanatory') {
    return {
      name: s,
      prompt:
        `\n# Output Style: Explanatory\n` +
        `- Before and after writing code, include brief educational insights about why a change is made and how it fits the codebase.\n` +
        `- Keep explanations concise and tied to the specific repository patterns.\n`,
    }
  }

  if (s === 'learning') {
    return {
      name: s,
      prompt:
        `\n# Output Style: Learning\n` +
        `- Prefer hands-on collaboration: for meaningful design choices, ask the user to pick between options.\n` +
        `- Keep tasks unblocked: implement routine parts yourself.\n`,
    }
  }

  return { name: 'default', prompt: '' }
}

