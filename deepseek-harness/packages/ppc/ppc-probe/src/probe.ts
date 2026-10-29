/**
 * The probe stage: run a proposed harness against the task and record what happened.
 *
 * A probe is a real run. It creates a fresh session whose working directory is the
 * staged harness, gives the agent the task, and lets the runtime load the harness's own
 * instructions and skills. Nothing about the run is simulated, because the whole value
 * of a probe is that it is the same code path the deployment will take.
 *
 * Two things make the run a fair comparison:
 *
 * - The session is FRESH. It inherits no turn of the caller's conversation, so a
 *   candidate is measured on its harness and not on what the proposer was thinking.
 * - The model is FROZEN. The same route and id for every candidate, so a difference
 *   between two rollouts is a difference between the harnesses and not between the
 *   sampling temperatures.
 *
 * @module
 */

import { join } from 'node:path'

import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent'
// Type-only: make `ctx.systemPrompt` resolve to the prompt registry, which is
// where the candidate's persona is registered — the deployment persona's own
// section, shadowed for this agent's scope.
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'

import { finalMessage, turnReason, withDeadline } from '@deepseek-ai/dsh-ppc-evidence'
import type { Surface } from '@deepseek-ai/dsh-ppc-surface'

import { stageHarness } from './harness.ts'
import type { HarnessTree } from '@deepseek-ai/dsh-ppc-surface'

/** How one probe is configured. */
export interface ProbeOptions {
  /** The surface the candidate harness is written against. */
  readonly surface: Surface
  /** The candidate harness tree. */
  readonly tree: HarnessTree
  /** The directory the candidate's harness is staged into. */
  readonly root: string
  /** The task the probe runs. */
  readonly task: string
  /** The candidate's label, used in the session id and the result. */
  readonly label: string
  /** The model route and id the probe runs on. The same for every candidate. */
  readonly agentOptions: { readonly provider?: string; readonly model?: string }
  /** How long the probe may run. */
  readonly timeoutMs: number
  /** A signal that cancels the probe. */
  readonly signal: AbortSignal
}

/** What one probe produced. */
export interface ProbeResult {
  /** The candidate's label. */
  readonly label: string
  /** The harness the probe ran, relative path to content. */
  readonly harness: HarnessTree
  /** Whether the probe ran to a delivered turn. */
  readonly delivered: boolean
  /** The `turn/end` reason, `none` when the log closed no turn. */
  readonly turnReason: string
  /** The final assistant text, which is what the probe produced. */
  readonly output: string
  /** The session's raw events, for the trajectory renderer. */
  readonly events: readonly SessionEvent[]
  /** The session id, so the log can be found again. */
  readonly sessionId: string
  /** The directory the harness was staged into. */
  readonly workspace: string
  /** Why the probe failed, when it did. */
  readonly error?: string
}

/**
 * Run one candidate harness against the task.
 *
 * The harness is staged first, so the session's working directory is a directory that
 * holds the proposal and nothing else. The persona is registered as a prompt section
 * because that is where DSH reads it from — `PERSONA.md` is a deployment identity, not a
 * file the runtime opens.
 * @param ctx - the caller's context, which owns the agent lifecycle.
 * @param options - how this probe runs.
 * @returns what the probe produced.
 */
export async function runProbe(ctx: Context, options: ProbeOptions): Promise<ProbeResult> {
  const staged = await stageHarness(options.surface, options.tree, options.root)
  const sessionId = SessionId(`ppc-probe-${options.label}-${crypto.randomUUID()}`)
  const handle = await ctx.agents.create({
    sessionId,
    meta: { cwd: staged.root, origin: 'subagent' },
    agentOptions: options.agentOptions,
    signal: options.signal,
    setup: (agentCtx) => {
      // The persona is a prompt section in DSH, and it shadows the deployment's own for
      // this agent's scope. Registering it here is what makes the probe run the
      // candidate's identity rather than the deployment's.
      if (staged.persona.length > 0) {
        agentCtx.systemPrompt.section({
          name: 'deployment:persona',
          order: 0,
          text: staged.persona,
        })
      }
    },
  })
  try {
    handle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: options.task }],
      source: { kind: 'user' },
    }))
    await withDeadline(handle.agent.whenIdle(), options.timeoutMs, options.signal, 'probe')
    const events = handle.agent.session.events
    const reason = turnReason(events)
    return {
      label: options.label,
      harness: options.tree,
      delivered: reason === 'completed',
      turnReason: reason,
      output: finalMessage(events),
      events,
      sessionId,
      workspace: staged.root,
    }
  } catch (error) {
    const events = handle.agent.session.events
    return {
      label: options.label,
      harness: options.tree,
      delivered: false,
      turnReason: turnReason(events),
      output: finalMessage(events),
      events,
      sessionId,
      workspace: staged.root,
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    await handle.dispose()
  }
}

/**
 * The directory one candidate's probe is staged into.
 * @param root - the working directory that holds the candidates.
 * @param label - the candidate's label.
 * @returns the candidate's staging directory.
 */
export function probeDir(root: string, label: string): string {
  return join(root, label)
}
