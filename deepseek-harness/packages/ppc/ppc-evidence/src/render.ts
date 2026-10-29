/**
 * Trajectory rendering over a session's raw log.
 *
 * Reads the log the harness itself decoded (`Session.events`, or `ctx.sessionQuery.readSession`
 * for one that is not live) and folds it into the shared `[ACTION]`/`[OBSERVATION]`/`[ERROR]`
 * grammar. Two rules come from dsh's own vocabulary rather than from this file:
 *
 * - Only append-origin surface events are transcript. `isAppendSurfaceEvent` exists because the
 *   model-visible surface shadows replaced ranges, so it is the wrong source for a record of
 *   what happened — rendering a compaction fold would erase real conversation.
 * - `tool/call` is log-only and absent from any surface, but a trajectory without tool names and
 *   arguments is not evidence of anything, so the raw log is read rather than the surface.
 *
 * @module
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-session'

/** Per-cell rendering budgets. */
export interface RenderBudget {
  /** Longest single observation or message body. */
  readonly obsTrunc: number
  /** Longest rendered tool-argument payload. */
  readonly argsTrunc: number
  /** Longest whole render; the tail is dropped with a counted marker. */
  readonly maxChars: number
}

const TRUNCATION = '…(+{n} chars — render truncation)'

/**
 * Clip to `n` characters, appending how many were dropped, never splitting a surrogate pair.
 * @param value - the text to clip; null and undefined render as empty.
 * @param n - longest body to keep, measured in UTF-16 units.
 * @returns the clipped text with a counted truncation marker, or the text unchanged when short enough.
 */
export function clip(value: unknown, n: number): string {
  // Only a primitive renders as itself; an object would stringify as "[object Object]", which
  // is noise in a trajectory, so it renders as empty.
  const text = (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : '').replace(/\0/g, '')
  if (n <= 0 || text.length <= n) return text
  let kept = text.slice(0, n)
  const last = kept.charCodeAt(kept.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) kept = kept.slice(0, -1)
  return `${kept}${TRUNCATION.replace('{n}', String(text.length - kept.length))}`
}

/** Concatenate the text of a content-block list; a non-list payload falls back to {@link textOf}. */
function blocksText(blocks: unknown, budget: number): string {
  if (!Array.isArray(blocks)) return textOf(blocks, budget)
  const out: string[] = []
  for (const block of blocks) {
    if (typeof block !== 'object' || block === null) continue
    const typed = block as { type?: unknown; text?: unknown }
    if (typed.type === 'text' && typeof typed.text === 'string') out.push(typed.text)
    else if (typed.type === 'reasoning' && typeof typed.text === 'string') {
      out.push(clip(typed.text, Math.min(budget, 2000)))
    }
  }
  return out.join('\n')
}

/** Best-effort text from a message-shaped payload: a string, `.text`, or a nested content list. */
function textOf(value: unknown, budget: number, depth = 0): string {
  if (typeof value === 'string') return value
  if (depth > 4 || value === null || typeof value !== 'object') return ''
  if (Array.isArray(value)) {
    return value.map(entry => textOf(entry, budget, depth + 1)).filter(Boolean).join('\n')
  }
  const record = value as Record<string, unknown>
  for (const key of ['text', 'content', 'summary', 'message']) {
    const found = record[key]
    if (typeof found === 'string' && found.trim()) return found
    if (typeof found === 'object' && found !== null) {
      const nested = textOf(found, budget, depth + 1)
      if (nested.trim()) return nested
    }
  }
  return ''
}

/** One `[ACTION] name(args)` line. Arguments are a JSON string on `tool/call` and already parsed
 * on an assistant message's tool-call block; both render identically. */
function action(name: string, args: unknown, budget: number): string {
  let payload: unknown = args
  if (typeof args === 'string') {
    try {
      payload = JSON.parse(args)
    } catch {
      payload = args
    }
  }
  const text = payload === null || payload === undefined ? '' : JSON.stringify(payload)
  return `${name}(${clip(text, budget)})`
}

/**
 * The `[turn/end]` reason, or `none` when the log closed no turn.
 * @param events - a session's raw log events.
 * @returns the last turn's reason kind, `unknown` when it carries none, or `none` when no turn closed.
 */
export function turnReason(events: readonly SessionEvent[]): string {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    if (event?.type !== 'turn/end') continue
    const reason = (event.data as { reason?: { kind?: unknown } }).reason
    return typeof reason?.kind === 'string' ? reason.kind : 'unknown'
  }
  return 'none'
}

/**
 * The last assistant text: what a caller reads as this run's deliverable.
 * @param events - a session's raw log events.
 * @returns the final non-empty assistant text, or an empty string when the run produced none.
 */
export function finalMessage(events: readonly SessionEvent[]): string {
  let last = ''
  for (const event of events) {
    if (event.type !== 'assistant/message' || !isAppendSurfaceEvent(event)) continue
    const message = (event.data as { message?: { content?: unknown } }).message
    for (const block of (message?.content ?? []) as { type?: unknown; text?: unknown }[]) {
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        last = block.text
      }
    }
  }
  return last
}

/** The error identity a failed tool result carries, as the two strings the trajectory shows. */
interface ErrorFields {
  readonly name: string
  readonly code: string
}

/** The error identity of a failed tool result, or null when it carries none. */
function errorFields(raw: unknown): ErrorFields | null {
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as { name?: unknown; code?: unknown }
  return {
    name: typeof record.name === 'string' ? record.name : '',
    code: typeof record.code === 'string' ? record.code : '',
  }
}

/**
 * Render a raw session log into the shared grammar.
 *
 * Reasoning is included because a proposer diagnosing a decision needs the deliberation, not only
 * its conclusion; `obsTrunc` caps what that costs.
 * @param events - a session's raw log events, in `seq` order.
 * @param budget - per-cell and whole-render truncation limits.
 * @returns the folded trajectory, or a no-readable-events marker when nothing rendered.
 */
export function renderTrajectory(events: readonly SessionEvent[], budget: RenderBudget): string {
  const lines: string[] = []
  for (const event of events) {
    const isSurface = event.type === 'user/message' || event.type === 'assistant/message'
      || event.type === 'tool/result'
    if (isSurface && !isAppendSurfaceEvent(event)) continue
    const data = event.data as Record<string, unknown>
    switch (event.type) {
      case 'user/message': {
        const text = clip(blocksText(data.content, budget.obsTrunc), budget.obsTrunc)
        if (text.trim()) lines.push(`[${userTag(data.source)}] ${text}`)
        break
      }
      case 'assistant/message': {
        const content = ((data.message ?? {}) as { content?: unknown }).content
        for (const block of (content ?? []) as {
          type?: unknown
          text?: unknown
          name?: unknown
          arguments?: unknown
        }[]) {
          const text = typeof block.text === 'string' ? block.text : ''
          if (block.type === 'reasoning' && text.trim()) {
            lines.push(`[REASONING] ${clip(text, budget.obsTrunc)}`)
          } else if (block.type === 'text' && text.trim()) {
            lines.push(`[ASSISTANT] ${clip(text, budget.obsTrunc)}`)
          } else if (block.type === 'tool-call') {
            lines.push(`[ACTION] ${action(
              typeof block.name === 'string' ? block.name : 'tool', block.arguments, budget.argsTrunc,
            )}`)
          }
        }
        break
      }
      case 'tool/call': {
        lines.push(`[ACTION] ${action(
          typeof data.name === 'string' ? data.name : 'tool', data.arguments, budget.argsTrunc,
        )}`)
        break
      }
      case 'tool/result': {
        const content = ((data.message ?? {}) as { content?: unknown }).content
        const first = (Array.isArray(content) ? content[0] : undefined) as
          { content?: unknown; isError?: unknown } | undefined
        const error = errorFields(data.error)
        const failed = first?.isError === true || error !== null
        const tag = failed ? 'OBSERVATION ERROR' : 'OBSERVATION'
        const suffix = failed && error
          ? ` | ${error.name}:${error.code}`
          : ''
        lines.push(`[${tag}] ${
          clip(blocksText(first?.content, budget.obsTrunc), budget.obsTrunc)
        }${suffix}`)
        break
      }
      case 'turn/end': {
        lines.push(`[HARNESS] turn ended: ${turnReason([event])}`)
        break
      }
      default:
        break
    }
  }
  const rendered = lines.join('\n').trim()
  if (!rendered) return '(no parseable events in trajectory)'
  if (rendered.length <= budget.maxChars) return rendered
  const dropped = rendered.length - budget.maxChars
  return `${rendered.slice(0, budget.maxChars)}\n${TRUNCATION.replace('{n}', String(dropped))}`
}

/** Label a message by its source: a plugin's context is harness text, not the user's words. */
function userTag(source: unknown): string {
  const record = (source ?? {}) as { kind?: unknown; plugin?: unknown }
  const kind = typeof record.kind === 'string' ? record.kind : 'user'
  if (kind === 'plugin') {
    return `HARNESS ${typeof record.plugin === 'string' ? record.plugin : 'plugin'}`
  }
  return kind.toUpperCase()
}
