/**
 * Running several candidate harnesses against the same task.
 *
 * A probe costs a model turn per candidate, so the number of them running at once is a
 * budget decision, not a correctness one. The width defaults to 2, matching harness2's
 * phase width: enough to hide a slow model call, few enough that a sweep does not spend
 * the whole budget at once.
 *
 * The candidates share a task and a model, and differ only in their harness. That is the
 * whole point of the stage, so the sweep measures one thing: what each harness produced.
 *
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'

import type { Surface } from '@deepseek-ai/dsh-ppc-surface'
import type { HarnessTree } from '@deepseek-ai/dsh-ppc-surface'

import { probeDir, runProbe, type ProbeOptions, type ProbeResult } from './probe.ts'

/** One candidate to probe. */
export interface ProbeCandidate {
  /** The candidate's label, unique within the run. */
  readonly label: string
  /** The harness tree to run. */
  readonly tree: HarnessTree
}

/** How a probe sweep is configured. */
export interface ProbeRunOptions {
  /** The surface the candidates are written against. */
  readonly surface: Surface
  /** The task every candidate runs. */
  readonly task: string
  /** The candidates to probe. */
  readonly candidates: readonly ProbeCandidate[]
  /** The directory the candidates are staged under. */
  readonly root: string
  /** The model route and id every candidate runs on. The same for all of them. */
  readonly agentOptions: { readonly provider?: string; readonly model?: string }
  /** How long one probe may run. */
  readonly timeoutMs: number
  /** How many probes may run at once. */
  readonly concurrency: number
  /** A signal that cancels the sweep. */
  readonly signal: AbortSignal
}

/** What a probe sweep produced. */
export interface ProbeRunResult {
  /** One result per candidate, in the order the candidates were given. */
  readonly results: readonly ProbeResult[]
  /** Candidates that were not run, with the reason. */
  readonly skipped: readonly { readonly label: string; readonly reason: string }[]
}

/**
 * The result of a candidate that could not even be staged.
 *
 * A candidate whose harness cannot be written to disk is a finding, not a reason to abort
 * the sweep: the other candidates still measure the harnesses they carry, and the dead one
 * is reported in the same vocabulary as any other failure.
 * @param label - the candidate's label.
 * @param tree - the harness it was to run.
 * @param error - why it could not be staged.
 * @returns the failed result.
 */
function unstagedResult(label: string, tree: HarnessTree, error: unknown): ProbeResult {
  return {
    label,
    harness: tree,
    delivered: false,
    turnReason: 'none',
    output: '',
    events: [],
    sessionId: '',
    workspace: '',
    error: error instanceof Error ? error.message : String(error),
  }
}

/**
 * Run a set of candidates against one task, at most `concurrency` at a time.
 *
 * A candidate that fails does not stop the sweep: a dead rollout is a finding, and the
 * other candidates still measure the harnesses they carry.
 * @param ctx - the caller's context, which owns the agent lifecycle.
 * @param options - how the sweep runs.
 * @returns one result per candidate, plus the candidates that were not run.
 */
export async function runProbes(ctx: Context, options: ProbeRunOptions): Promise<ProbeRunResult> {
  const skipped: { label: string; reason: string }[] = []
  const seen = new Set<string>()
  const runnable: ProbeCandidate[] = []
  for (const candidate of options.candidates) {
    if (seen.has(candidate.label)) {
      skipped.push({ label: candidate.label, reason: 'duplicate label' })
      continue
    }
    seen.add(candidate.label)
    runnable.push(candidate)
  }

  const results: ProbeResult[] = []
  const width = Math.max(1, Math.min(options.concurrency, runnable.length))
  let next = 0
  const workers = Array.from({ length: width }, async () => {
    while (next < runnable.length) {
      const index = next
      next += 1
      const candidate = runnable[index]
      /* v8 ignore next -- index is read and incremented synchronously, so it always stays below runnable.length and is present */
      if (candidate === undefined) return
      const probeOptions: ProbeOptions = {
        surface: options.surface,
        tree: candidate.tree,
        root: probeDir(options.root, candidate.label),
        task: options.task,
        label: candidate.label,
        agentOptions: options.agentOptions,
        timeoutMs: options.timeoutMs,
        signal: options.signal,
      }
      try {
        // The index is the candidate's position, so the results come back in the order the
        // candidates were given whatever order they finished in.
        results[index] = await runProbe(ctx, probeOptions)
      } catch (error) {
        results[index] = unstagedResult(candidate.label, candidate.tree, error)
      }
    }
  })
  await Promise.all(workers)
  return { results, skipped }
}
