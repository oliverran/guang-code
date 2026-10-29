/**
 * Turning a probe's run into evidence a later stage can read.
 *
 * A probe produces a session log. The stages that come after it — a proposer reading what
 * happened, a selector choosing between candidates — read a directory, not a log. This
 * module is the hand-off between the two: it renders the log into the shared trajectory
 * grammar and shapes it into the evidence tree's own vocabulary.
 *
 * The boundary declaration is NOT added here. `dsh-ppc-evidence` prepends it to every
 * trajectory file it writes, and a declaration added twice is a declaration a reader has to
 * read past twice — the second copy costs tokens and says nothing the first did not.
 *
 * @module
 */

import { renderTrajectory, type RenderBudget } from '@deepseek-ai/dsh-ppc-evidence'
import type { EvidenceCandidate, EvidenceRollout } from '@deepseek-ai/dsh-ppc-evidence'
import { diffTree } from '@deepseek-ai/dsh-ppc-surface'
import type { HarnessTree } from '@deepseek-ai/dsh-ppc-surface'

import type { ProbeResult } from './probe.ts'

/**
 * Whether a rendered trajectory holds any readable event.
 *
 * The renderer answers `(no parseable events in trajectory)` for a log it cannot read, and
 * that answer is a finding rather than a trajectory, so the two are told apart.
 * @param trajectory - the rendered trajectory.
 * @returns whether the trajectory holds readable events.
 */
export function hasReadableEvents(trajectory: string): boolean {
  return trajectory.includes('[USER]')
    || trajectory.includes('[ASSISTANT]')
    || trajectory.includes('[OBSERVATION]')
    || trajectory.includes('[ACTION]')
}

/**
 * The rendered trajectory of one probe, in the shared grammar.
 * @param result - the probe's run.
 * @param budget - the render budget.
 * @returns the rendered trajectory.
 */
export function trajectoryOf(result: ProbeResult, budget: RenderBudget): string {
  return renderTrajectory(result.events, budget)
}

/**
 * The output file body: what the probe's agent said, or why it said nothing.
 *
 * A probe that produced no text is not a probe that produced a zero — it is a probe whose
 * run ended before the agent answered, and the reason is the finding.
 * @param result - the probe's run.
 * @returns the file body.
 */
export function producedBody(result: ProbeResult): string {
  if (result.output.trim().length > 0) return result.output
  if (result.error !== undefined) return `(the probe failed: ${result.error})`
  return `(the probe produced no output; the turn ended as ${result.turnReason})`
}

/**
 * One probe's pool entry: the candidate's harness, its diff, its rollout, its output.
 *
 * The diff is against the base harness, because a candidate's value is what it changed
 * relative to the harness it was derived from — a diff against anything else would measure
 * a different thing.
 * @param result - the probe's run.
 * @param base - the harness the candidate was derived from.
 * @param budget - the render budget.
 * @returns the pool entry.
 */
export function probeCandidate(
  result: ProbeResult,
  base: HarnessTree,
  budget: RenderBudget,
): EvidenceCandidate {
  return {
    label: result.label,
    harness: result.harness,
    diff: diffTree(base, result.harness, result.label),
    trajectory: trajectoryOf(result, budget),
    produced: producedBody(result),
  }
}

/**
 * One probe's rollout entry: what the run did, in the tree's rollout vocabulary.
 *
 * The trajectory is the same render the pool entry carries, so a reader that opens the
 * candidate's rollout and a reader that opens the rollout index see the same events.
 * @param result - the probe's run.
 * @param budget - the render budget.
 * @returns the rollout entry.
 */
export function probeRollout(result: ProbeResult, budget: RenderBudget): EvidenceRollout {
  return {
    label: result.label,
    sessionId: result.sessionId,
    trajectory: trajectoryOf(result, budget),
    deliverables: {},
    delivered: result.delivered,
    turnReason: result.turnReason,
  }
}

/**
 * One sweep's evidence: the rollouts it produced and the candidates it measured.
 *
 * The two lists describe the same runs from two directions. The rollouts are what a
 * proposer reads to understand what happened; the candidates are what a selector reads to
 * choose between harnesses. A selector must be able to see them without also seeing which
 * one is the base — that anonymity is the selector's job to preserve, so this function
 * hands over the candidates without ranking them.
 * @param results - the sweep's results, in the order the candidates were given.
 * @param base - the harness every candidate was derived from.
 * @param budget - the render budget.
 * @returns the rollouts and the candidates.
 */
export function probeEvidence(
  results: readonly ProbeResult[],
  base: HarnessTree,
  budget: RenderBudget,
): { readonly rollouts: readonly EvidenceRollout[]; readonly candidates: readonly EvidenceCandidate[] } {
  return {
    rollouts: results.map(result => probeRollout(result, budget)),
    candidates: results.map(result => probeCandidate(result, base, budget)),
  }
}
