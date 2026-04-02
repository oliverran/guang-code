export const PREAPPROVED_HOSTS = new Set([
  'developer.mozilla.org',
  'nodejs.org',
  'docs.npmjs.com',
  'www.npmjs.com',
  'github.com',
  'raw.githubusercontent.com',
  'api.github.com',
  'learn.microsoft.com',
  'docs.microsoft.com',
  'pypi.org',
  'crates.io',
  'doc.rust-lang.org',
  'www.typescriptlang.org',
  'anthropic.com',
  'docs.anthropic.com',
  'openai.com',
  'platform.openai.com',
])

export function isPreapprovedHost(hostname: string): boolean {
  const h = (hostname ?? '').toLowerCase()
  if (!h) return false
  if (PREAPPROVED_HOSTS.has(h)) return true
  if (h.endsWith('.githubusercontent.com')) return true
  return false
}

