/**
 * The reader session: a fresh agent that reads a directory and answers one question.
 *
 * Two stages of the loop have exactly this shape. The compose stage's selector reads a
 * candidate pool and names one candidate; the library stage's distiller reads a finished
 * round's record and writes one lesson. Neither edits anything, neither inherits the
 * caller's conversation, and both see only the directory they were pointed at.
 *
 * The properties are the point, so they live here rather than in each stage:
 *
 * - It is FRESH. It inherits no turn of the caller's conversation and no memory of which
 *   candidate came from which harness.
 * - Its working directory IS the directory it reads, so every path it opens is one the
 *   caller named. It cannot wander into a neighbouring candidate, an evidence tree, or a
 *   probe's workspace.
 * - Its write capability is ZERO. A reader that could write could edit the thing it is
 *   reasoning about, and its answer would then describe a record that never existed. A
 *   capability the agent can see is a capability it may try, and a denied call costs a
 *   turn to no end, so the surface is reduced to the read tools rather than left to the
 *   sandbox.
 *
 * A deployment that mounts none of the read tools keeps its whole surface: with nothing
 * to read, the directory's files are the mission's own subject, and removing every tool
 * would leave the reader with no way to answer at all.
 *
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-tools'

import { finalMessage, turnReason } from './render.ts'
import { withDeadline } from './deadline.ts'

/** The tools a reader session may call. */
export const READER_TOOLS = ['read', 'grep', 'glob'] as const

/** How one reader session is configured. */
export interface ReaderOptions {
  /** The directory the reader may read; it is also the session's working directory. */
  readonly root: string
  /** The mission text: what to read and what to answer. */
  readonly mission: string
  /** The model route and id the reader runs on. */
  readonly agentOptions: { readonly provider?: string; readonly model?: string }
  /** How long the reader may run. */
  readonly timeoutMs: number
  /** A signal that cancels the session. */
  readonly signal: AbortSignal
  /** The name the session id carries, so a log can be traced to its stage. */
  readonly label: string
  /** The subject the timeout message names. */
  readonly subject: string
}

/** What one reader session produced. */
export interface ReaderResult {
  /** The reader's final assistant text. */
  readonly output: string
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
 * Run one reader session over a directory.
 *
 * A session that fails is reported, not thrown: the caller's fallback is a stand-in it
 * already owns, and a fallback that only ran when the reader succeeded would leave a
 * failed reader with no result at all.
 * @param ctx - the caller's context, which owns the agent lifecycle.
 * @param options - how this reader session runs.
 * @returns what the session produced.
 */
export async function runReader(ctx: Context, options: ReaderOptions): Promise<ReaderResult> {
  const sessionId = SessionId(`ppc-${options.label}-${crypto.randomUUID()}`)
  const handle = await ctx.agents.create({
    sessionId,
    meta: { cwd: options.root, origin: 'subagent' },
    agentOptions: options.agentOptions,
    signal: options.signal,
    setup: (agentCtx) => {
      const readable = READER_TOOLS.filter(name => agentCtx.tools.get(name) !== undefined)
      if (readable.length > 0) agentCtx.tools.restrict({ allow: readable })
    },
  })
  try {
    handle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: options.mission }],
      source: { kind: 'user' },
    }))
    await withDeadline(handle.agent.whenIdle(), options.timeoutMs, options.signal, options.subject)
    const events = handle.agent.session.events
    const reason = turnReason(events)
    return {
      output: finalMessage(events),
      turnReason: reason,
      delivered: reason === 'completed',
      events,
      sessionId,
    }
  } catch (error) {
    const events = handle.agent.session.events
    return {
      output: finalMessage(events),
      turnReason: turnReason(events),
      delivered: false,
      events,
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    await handle.dispose()
  }
}
