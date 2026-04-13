export function replaceLastToken(input: string, replacement: string): string {
  const m = input.match(/^(.*?)(\S*)$/)
  const prefix = m?.[1] ?? ''
  return `${prefix}${replacement}`
}

export function lastToken(input: string): string {
  const m = input.match(/(\S*)$/)
  return m?.[1] ?? ''
}

