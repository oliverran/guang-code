/**
 * The distiller session: a fresh agent that reads a finished round and writes its lesson.
 *
 * The session is narrow on purpose:
 *
 * - It is FRESH, so it inherits no turn of the caller's conversation and no memory of
 *   which candidate the selector preferred.
 * - Its working directory IS the round's record, so every path it reads is a record path.
 * - Its write capability is ZERO. It reads the round and it answers; it changes nothing.
 *   A distiller that could write could edit the evidence it is reasoning about, and the
 *   lesson would then describe a record that never existed.
 *
 * The session itself is {@link runReader}, which the compose stage's selector shares: both
 * read a directory and answer one question, and the properties that make them safe to run
 * are the same properties.
 *
 * A distiller that fails, times out, or declines produces NO lesson. That is the correct
 * outcome, not a failure to work around: the library's admission gate refuses a lesson
 * that is missing a required field anyway, and a round that supports no lesson is a round
 * that taught nothing.
 *
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

import { runReader } from '@deepseek-ai/dsh-ppc-evidence'

import { declined } from './distil.ts'
import { hasExperience, parseExperience } from './experience.ts'
import type { Experience } from './experience.ts'

/** The tools a distiller session may call. */
export const DISTILLER_TOOLS = ['read', 'grep', 'glob'] as const

/** How one distiller session is configured. */
export interface DistillerOptions {
  /** The directory holding the round's record; it is also the session's working directory. */
  readonly root: string
  /** The mission text: what to read and what to write. */
  readonly mission: string
  /** The model route and id the distiller runs on. */
  readonly agentOptions: { readonly provider?: string; readonly model?: string }
  /** How long the distiller may run. */
  readonly timeoutMs: number
  /** A signal that cancels the session. */
  readonly signal: AbortSignal
}

/** What one distiller session produced. */
export interface DistillerResult {
  /** The lesson it wrote, when it wrote one that qualifies. */
  readonly experience?: Experience
  /** Whether the session declined to write a lesson. */
  readonly declined: boolean
  /** The reason the session ended. */
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
 * Run one distiller session over a finished round.
 *
 * A session that fails is reported, not thrown: the caller stores nothing in that case,
 * and a thrown error would cost the caller the whole round's other results.
 * @param ctx - the caller's context, which owns the agent lifecycle.
 * @param options - how this distiller session runs.
 * @returns the lesson it produced, and the session's own state.
 */
export async function runDistiller(ctx: Context, options: DistillerOptions): Promise<DistillerResult> {
  const reader = await runReader(ctx, {
    root: options.root,
    mission: options.mission,
    agentOptions: options.agentOptions,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
    label: 'library-distil',
    subject: 'distiller session',
  })
  const base = {
    turnReason: reader.turnReason,
    delivered: reader.delivered,
    events: reader.events,
    sessionId: reader.sessionId,
    ...reader.error === undefined ? {} : { error: reader.error },
  }
  if (declined(reader.output)) return { ...base, declined: true }
  const parsed = parseExperience(reader.output)
  if (!hasExperience(parsed)) {
    // The reply carried no complete record. That is the same outcome as a decline: the
    // round taught nothing that could be stored.
    return { ...base, declined: true }
  }
  return { ...base, experience: parsed, declined: false }
}
