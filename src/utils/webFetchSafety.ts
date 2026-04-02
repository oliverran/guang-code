import dns from 'dns/promises'

export type ValidatedUrl = {
  url: URL
  normalized: string
  hostname: string
}

export function validateUrlString(raw: string): ValidatedUrl {
  const s = (raw ?? '').toString().trim()
  if (!s) throw new Error('URL is required.')
  if (s.length > 2048) throw new Error('URL is too long.')
  if (/[\u0000-\u001F\u007F]/.test(s)) throw new Error('URL contains control characters.')
  let u: URL
  try {
    u = new URL(s)
  } catch {
    throw new Error('Invalid URL.')
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http/https URLs are allowed.')
  if (u.username || u.password) throw new Error('URLs with credentials are not allowed.')
  const hostname = (u.hostname ?? '').toLowerCase()
  if (!hostname) throw new Error('URL hostname is required.')
  const normalized = u.toString()
  return { url: u, normalized, hostname }
}

export function isLoopbackHost(hostname: string): boolean {
  const h = (hostname ?? '').toLowerCase()
  if (h === 'localhost') return true
  if (h.endsWith('.localhost')) return true
  if (h === '::1') return true
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true
  return false
}

export function isIpLiteral(hostname: string): boolean {
  const h = (hostname ?? '').toLowerCase()
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true
  if (h.includes(':')) return true
  return false
}

export function isPrivateOrLinkLocalIp(ip: string): boolean {
  const s = (ip ?? '').toLowerCase()
  if (!s) return false
  if (s.includes(':')) return isPrivateOrLinkLocalV6(s)
  return isPrivateOrLinkLocalV4(s)
}

function isPrivateOrLinkLocalV4(ip: string): boolean {
  const parts = ip.split('.').map(n => Number(n))
  if (parts.length !== 4 || parts.some(n => !Number.isFinite(n) || n < 0 || n > 255)) return false
  const [a, b] = parts
  if (a === 10) return true
  if (a === 127) return true
  if (a === 0) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 198 && (b === 18 || b === 19)) return true
  if (a === 224) return true
  return false
}

function isPrivateOrLinkLocalV6(ip: string): boolean {
  if (ip === '::1') return true
  if (ip.startsWith('fe80:')) return true
  if (ip.startsWith('fc') || ip.startsWith('fd')) return true
  return false
}

export async function resolveHostIps(hostname: string): Promise<string[]> {
  const h = (hostname ?? '').toLowerCase()
  if (!h) return []
  if (isIpLiteral(h)) return [h]
  try {
    const res = await dns.lookup(h, { all: true, verbatim: true })
    return res.map(r => r.address).filter(Boolean)
  } catch {
    return []
  }
}

