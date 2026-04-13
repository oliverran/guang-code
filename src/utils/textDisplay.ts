export function appendTailWindow(prev: string, next: string, maxChars: number): string {
  if (!next) return prev
  const combined = prev + next
  if (combined.length <= maxChars) return combined
  return combined.slice(Math.max(0, combined.length - maxChars))
}

export function truncateForDisplay(
  text: string,
  opts: {
    maxChars: number
    maxLines?: number
    headLines?: number
    tailLines?: number
    headChars?: number
    tailChars?: number
    marker?: string
  },
): { text: string; truncated: boolean } {
  const marker = opts.marker ?? '… (truncated)'
  const normalized = (text ?? '').replace(/\r\n/g, '\n')
  if (!normalized) return { text: '', truncated: false }

  let out = normalized
  let truncated = false

  if (opts.maxLines && opts.maxLines > 0) {
    const lines = out.split('\n')
    if (lines.length > opts.maxLines) {
      const headLines = Math.max(1, opts.headLines ?? Math.floor(opts.maxLines * 0.7))
      const tailLines = Math.max(1, opts.tailLines ?? (opts.maxLines - headLines))
      const head = lines.slice(0, headLines).join('\n')
      const tail = lines.slice(Math.max(0, lines.length - tailLines)).join('\n')
      out = `${head}\n${marker}\n${tail}`
      truncated = true
    }
  }

  if (opts.maxChars > 0 && out.length > opts.maxChars) {
    const headChars = Math.max(0, opts.headChars ?? Math.floor(opts.maxChars * 0.7))
    const tailChars = Math.max(0, opts.tailChars ?? (opts.maxChars - headChars))
    const head = out.slice(0, headChars)
    const tail = tailChars > 0 ? out.slice(Math.max(0, out.length - tailChars)) : ''
    out = tail ? `${head}\n${marker}\n${tail}` : `${head}\n${marker}`
    truncated = true
  }

  return { text: out, truncated }
}

