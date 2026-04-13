// ============================================================
//  Guang Code — WebFetchTool
// ============================================================

import type { ToolDef, ToolContext, ToolResult } from '../types/index.js'
import { isLoopbackHost, isPrivateOrLinkLocalIp, resolveHostIps, validateUrlString } from '../utils/webFetchSafety.js'

export const WebFetchTool: ToolDef = {
  name: 'WebFetch',
  description:
    'Fetch the content of a URL and return it as text. Useful for reading documentation, API references, GitHub issues, etc.',
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to fetch',
      },
      max_length: {
        type: 'number',
        description: 'Maximum characters to return (default: 20000)',
      },
    },
    required: ['url'],
  },

  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const url = input.url as string
    const maxLen = (input.max_length as number | undefined) ?? 20000

    try {
      const allowLocal = process.env.GC_ALLOW_LOCALHOST_WEBFETCH === '1'
      const maxRedirects = 5
      let current = validateUrlString(url).normalized
      let response: Response | null = null

      for (let hop = 0; hop <= maxRedirects; hop++) {
        const v = validateUrlString(current)
        if (!allowLocal && isLoopbackHost(v.hostname)) {
          return { content: 'Blocked URL hostname (loopback) for safety.', isError: true }
        }
        const ips = await resolveHostIps(v.hostname)
        if (!allowLocal) {
          if (ips.some(ip => isPrivateOrLinkLocalIp(ip))) {
            return { content: 'Blocked URL hostname (private/link-local) for safety.', isError: true }
          }
        }

        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 15000)
        response = await fetch(v.normalized, {
          signal: controller.signal,
          redirect: 'manual',
          headers: {
            'User-Agent': 'Guang-Code/1.0',
            Accept: 'text/html,text/plain,application/json,*/*',
          },
        })
        clearTimeout(timeout)

        if (response.status >= 300 && response.status < 400) {
          const loc = response.headers.get('location')
          if (!loc) {
            return { content: `HTTP ${response.status} redirect without Location header for ${v.normalized}`, isError: true }
          }
          current = new URL(loc, v.url).toString()
          continue
        }

        break
      }

      if (!response) {
        return { content: `Fetch failed: no response for ${url}`, isError: true }
      }

      if (!response.ok) {
        return {
          content: `HTTP ${response.status} ${response.statusText} for ${url}`,
          isError: true,
        }
      }

      const contentType = response.headers.get('content-type') ?? ''
      const text = await response.text()

      let content: string
      if (contentType.includes('application/json')) {
        try {
          content = JSON.stringify(JSON.parse(text), null, 2)
        } catch {
          content = text
        }
      } else {
        // Strip HTML tags for readability
        content = text
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s{2,}/g, ' ')
          .trim()
      }

      if (content.length > maxLen) {
        content = content.slice(0, maxLen) + `\n\n... (truncated, ${content.length - maxLen} more chars)`
      }

      return { content: `URL: ${current}\nContent-Type: ${contentType}\n\n${content}` }
    } catch (err: unknown) {
      const e = err as Error
      if (e.name === 'AbortError') {
        return { content: `Fetch timed out for: ${url}`, isError: true }
      }
      return { content: `Fetch failed: ${e.message}`, isError: true }
    }
  },
}
