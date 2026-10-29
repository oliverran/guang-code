/**
 * The compose stage: choose one candidate output, and never deliver nothing.
 *
 * The stage is one selector session over an anonymous pool. Two rules govern the outcome:
 *
 * - The selector picks on ARTIFACTS. It never sees which candidate came from the
 *   unmodified harness and which came from an adapted one, so picking the base is a real
 *   answer and not a tie-break.
 * - A selector that fails, times out, or answers with an id the pool never issued falls
 *   back to a DELIVERED candidate. The fallback is not a preference: it is the neutral
 *   stand-in, because a stage that delivered nothing would waste the whole round.
 *
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'

import { entryFor } from './anonymity.ts'
import type { PoolEntry } from './anonymity.ts'
import { writePool } from './pool.ts'
import type { PoolCandidate, SelectionPool } from './pool.ts'
import { selectMission } from './prompt.ts'
import { runSelector } from './selector.ts'
import type { SelectorResult } from './selector.ts'

/** How one compose stage is configured. */
export interface ComposeOptions {
  /** The directory the pool is written to. */
  readonly root: string
  /** The task text as the agent received it. */
  readonly task: string
  /** The candidates, each with its label and what it produced. */
  readonly candidates: readonly PoolCandidate[]
  /** Source material the work was done against, filename to text. */
  readonly source?: Readonly<Record<string, string>>
  /** The label of the base candidate, used as the fallback when the selector fails. */
  readonly baseLabel?: string
  /** The seed the anonymous ids are derived from. */
  readonly seed: string
  /** The model route and id the selector runs on. */
  readonly agentOptions: { readonly provider?: string; readonly model?: string }
  /** How long the selector may run. */
  readonly timeoutMs: number
  /** A signal that cancels the stage. */
  readonly signal: AbortSignal
}

/** What the compose stage decided. */
export interface ComposeResult {
  /** The candidate that was chosen. */
  readonly chosen?: PoolEntry
  /** The selector's reasoning, when it gave one. */
  readonly why: string
  /** Whether the choice came from the fallback rather than from the selector. */
  readonly fallback: boolean
  /** Why the fallback was taken, when it was. */
  readonly error?: string
  /** The pool the selector read. */
  readonly pool: SelectionPool
  /** The selector session's own result, when one ran. */
  readonly selector?: SelectorResult
}

/**
 * Choose one candidate.
 *
 * The fallback picks the base candidate when the pool holds one, because the base is the
 * outcome that needs no justification: it is what the deployment would have shipped had
 * the round never happened. Without a base, the first pool entry stands in, so the stage
 * still delivers an output somebody produced.
 * @param ctx - the caller's context, which owns the agent lifecycle.
 * @param options - the task, the candidates, the source material, and the model route.
 * @returns the choice, the reasoning, and the pool it was made from.
 */
export async function compose(ctx: Context, options: ComposeOptions): Promise<ComposeResult> {
  const pool = await writePool({
    root: options.root,
    task: options.task,
    candidates: options.candidates,
    ...options.source === undefined ? {} : { source: options.source },
    seed: options.seed,
  })

  if (pool.entries.length === 0) {
    return {
      why: '',
      fallback: true,
      error: 'no candidate produced an answer',
      pool,
    }
  }

  const mission = selectMission(pool.ids, pool.layout, options.task)
  const selector = await runSelector(ctx, {
    root: options.root,
    mission,
    ids: pool.ids,
    agentOptions: options.agentOptions,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
  })

  const chosen = selector.choice === undefined ? undefined : entryFor(pool.entries, selector.choice.id)
  if (chosen !== undefined) {
    /* v8 ignore next -- a defined chosen means choice is defined and why is a string, so this arm is dead */
    return { chosen, why: selector.choice?.why ?? '', fallback: false, pool, selector }
  }

  const fallback = fallbackEntry(pool, options.baseLabel)
  const error = selector.error
    ?? (selector.named === undefined
      ? 'the selector did not name one of the pool ids'
      : `the selector named "${selector.named.id}", which the pool did not issue`)
  /* v8 ignore next 2 -- pool.entries is non-empty, so fallbackEntry returns entries[0]; the undefined arm is never runtime */
  if (fallback === undefined) {
    return { why: '', fallback: true, error, pool, selector }
  }
  return { chosen: fallback, why: '', fallback: true, error, pool, selector }
}

/**
 * The neutral stand-in after a selector failure: the base candidate when the pool holds
 * one, else the first entry.
 * @param pool - the pool the selector chose from.
 * @param baseLabel - the base candidate's label, when the caller named one.
 * @returns the fallback entry, or undefined when the pool is empty.
 */
function fallbackEntry(pool: SelectionPool, baseLabel: string | undefined): PoolEntry | undefined {
  if (baseLabel !== undefined) {
    const base = pool.entries.find(entry => entry.label === baseLabel)
    if (base !== undefined) return base
  }
  return pool.entries[0]
}
