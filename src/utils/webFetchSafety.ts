import dns from 'dns/promises'
import { isIP } from 'net'

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
  const v = isIP(s)
  if (v === 6) return isPrivateOrLinkLocalV6(s)
  if (v === 4) return isPrivateOrLinkLocalV4(s)
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
  if (ip === '::') return true

  const mapped = extractMappedIPv4(ip)
  if (mapped) return isPrivateOrLinkLocalV4(mapped)

  if (ip.startsWith('fe80:')) return true
  if (ip.startsWith('fc') || ip.startsWith('fd')) return true
  return false
}

function expandIPv6Groups(addr: string): number[] | null {
  let tailHextets: number[] = []
  if (addr.includes('.')) {
    const lastColon = addr.lastIndexOf(':')
    const v4 = addr.slice(lastColon + 1)
    addr = addr.slice(0, lastColon)
    const octets = v4.split('.').map(Number)
    if (octets.length !== 4 || octets.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null
    tailHextets = [
      (octets[0]! << 8) | octets[1]!,
      (octets[2]! << 8) | octets[3]!,
    ]
  }

  const dbl = addr.indexOf('::')
  let head: string[]
  let tail: string[]
  if (dbl === -1) {
    head = addr.split(':')
    tail = []
  } else {
    const headStr = addr.slice(0, dbl)
    const tailStr = addr.slice(dbl + 2)
    head = headStr === '' ? [] : headStr.split(':')
    tail = tailStr === '' ? [] : tailStr.split(':')
  }

  const target = 8 - tailHextets.length
  const fill = target - head.length - tail.length
  if (fill < 0) return null

  const hex = [...head, ...new Array<string>(fill).fill('0'), ...tail]
  const nums = hex.map(h => parseInt(h || '0', 16))
  if (nums.some(n => Number.isNaN(n) || n < 0 || n > 0xffff)) return null
  nums.push(...tailHextets)
  return nums.length === 8 ? nums : null
}

function extractMappedIPv4(addr: string): string | null {
  const g = expandIPv6Groups(addr)
  if (!g) return null
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff) {
    const hi = g[6]!
    const lo = g[7]!
    const a = (hi >> 8) & 0xff
    const b = hi & 0xff
    const c = (lo >> 8) & 0xff
    const d = lo & 0xff
    return `${a}.${b}.${c}.${d}`
  }
  return null
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
