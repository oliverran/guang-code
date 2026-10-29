/**
 * The selector session: a fresh agent that picks one anonymous candidate.
 *
 * The selector's job is narrow, and the session is narrow to match it:
 *
 * - It is FRESH, so it inherits no turn of the caller's conversation and no memory of
 *   which candidate came from which harness.
 * - Its working directory IS the pool, so every path it reads is a pool path — it cannot
 *   wander into the candidate harnesses, the evidence tree, or the probes' workspaces.
 * - Its write capability is ZERO. It reads and it answers; it makes no change. A selector
 *   that could edit could also edit the candidate it prefers, and the anonymity that makes
 *   the choice meaningful would be gone.
 *
 * The session itself is {@link runReader}, which the library stage's distiller shares: both
 * read a directory and answer one question, and the properties that make them safe to run
 * are the same properties.
 *
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

import { runReader } from '@deepseek-ai/dsh-ppc-evidence'

import { namedChoice, parseChoice } from './choice.ts'
import type { ParsedChoice } from './choice.ts'

/** The tools a selector session may call. */
export const SELECTOR_TOOLS = ['read', 'grep', 'glob'] as const

/** How one selector session is configured. */
export interface SelectorOptions {
  /** The pool directory the selector reads; it is also the session's working directory. */
  readonly root: string
  /** The mission text: what to do and what it may read. */
  readonly mission: string
  /** The anonymous ids the selector may choose from. */
  readonly ids: readonly string[]
  /** The model route and id the selector runs on. */
  readonly agentOptions: { readonly provider?: string; readonly model?: string }
  /** How long the selector may run. */
  readonly timeoutMs: number
  /** A signal that cancels the session. */
  readonly signal: AbortSignal
}

/** What one selector session produced. */
export interface SelectorResult {
  /** The selector's final assistant text. */
  readonly output: string
  /** The id the selector named, when its reply carried a choice block at all. */
  readonly named?: ParsedChoice
  /** The choice it made, when the id it named is one the pool issued. */
  readonly choice?: ParsedChoice
  /** The reason the turn ended. */
  readonly turnReason: string
  /** Whether the turn ended as `completed`. */
  readonly delivered: boolean
  /** The session's raw events, for the trajectory renderer. */
  readonly events: readonly SessionEvent[]
  /** The session id, so the log can be found again. */
  readonly sessionId: string
  /** Why the session failed, when it did. */
  readonly error?: string
}

/**
 * Run one selector session over the pool.
 *
 * A session that fails is reported, not thrown: the caller's fallback is a delivered
 * candidate, and a fallback that only ran when the selector succeeded would leave a
 * failed selector with no output at all.
 * @param ctx - the caller's context, which owns the agent lifecycle.
 * @param options - how this selector session runs.
 * @returns what the session produced.
 */
export async function runSelector(ctx: Context, options: SelectorOptions): Promise<SelectorResult> {
  const reader = await runReader(ctx, {
    root: options.root,
    mission: options.mission,
    agentOptions: options.agentOptions,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
    label: 'compose',
    subject: 'selector session',
  })
  const named = namedChoice(reader.output)
  const choice = parseChoice(reader.output, options.ids)
  return {
    output: reader.output,
    ...named === undefined ? {} : { named },
    ...choice === undefined ? {} : { choice },
    turnReason: reader.turnReason,
    delivered: reader.delivered,
    events: reader.events,
    sessionId: reader.sessionId,
    ...reader.error === undefined ? {} : { error: reader.error },
  }
}
