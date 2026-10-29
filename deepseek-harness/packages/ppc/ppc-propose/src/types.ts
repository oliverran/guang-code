/**
 * The propose stage: one editor session that rewrites a harness copy in place.
 *
 * Unlike harness2, which runs the proposer in a throwaway workspace and copies the edited
 * tree back out, the editor here edits the staged harness directly. The proposal IS the
 * staged tree, so there is no separate "proposal format" to reproduce and no apply step that
 * can lose an edit.
 *
 * @module
 */

/** What one propose attempt produced. */
export interface Proposal {
  /** The candidate's label, as the caller named it. */
  readonly label: string
  /** Whether the attempt produced a usable proposal. */
  readonly ok: boolean
  /** The proposer's own notes, as the `<notes>` block it replied with. */
  readonly notes: string
  /** The harness tree the proposer left on disk. */
  readonly tree: Readonly<Record<string, string>>
  /** The files that existed on disk but are off the editable surface. */
  readonly rejected: readonly string[]
  /** Why the attempt failed, when it did. */
  readonly error?: string
}

/** One dimension a proposal may be drawn along. */
export type ProposalDimension = 'INV' | 'DOM'

/**
 * The dimension's instruction: what the proposal is allowed to own.
 *
 * `INV` owns procedure, tool use and completion. `DOM` owns the practitioner model the agent
 * lacks. The split is what keeps two independently drawn candidates from overlapping.
 */
export const DIMENSION_PROMPTS: Readonly<Record<ProposalDimension, string>> = {
  INV: `# YOUR DIMENSION: INV -- how the agent WORKS

You own procedure, tool use and completion -- not subject matter. Trace the workflow, fix its
earliest observed divergence, and match each failure to the cheapest effective component:

- TOOL ERROR: distinguish bad input from timeout, missing capability, permission, or unread
  output. Give one bounded fallback and stop condition; never prescribe blind repetition.
- MECHANICAL REPETITION: use \`scripts/<name>.py\` for repeated deterministic extraction,
  conversion or checking, with clear inputs, outputs and failure behavior.
- TRIGGERED WORKFLOW: use an on-demand skill for a narrow multi-step procedure, name its trigger
  in always-on text, and carry any helper it requires.
- ORDINARY SEQUENCING: prefer concise always-on guidance. Do not add code for a one-off
  mistake or automate professional judgment.

Do not add professional rules, required domain sections or matter facts. A parallel candidate
owns them; stay focused on how the agent works.`,

  DOM: `# YOUR DIMENSION: DOM -- what a PRACTITIONER knows

You own the practitioner model the agent lacks: the deliverable, audience and decision,
controlling sources, required structure, consistency relationships, and expert omissions.

Turn it into checkable rules:

- ANALYTIC MOVE: name the operation -- compare, reconcile, calculate, classify, trace, draft
  or explain -- its inputs and required result.
- ARTIFACT CONTRACT: name required parts, their dependencies, and domain checks for consistency
  and practical use.
- DECISION RULE: state the trigger, supporting evidence, conflicts to resolve, and uncertainty
  that must remain explicit.
- ENCODING: choose the FORM as deliberately as the content. A skill is the default home for
  domain knowledge that has a recognisable trigger. It costs nothing until that situation
  arises, and the next task in this domain can invoke it.

Two hard rules:
- Never invent an authority, identifier, standard or citation. Point to an authorized source;
  asserting it requires evidence.
- State knowledge the agent can APPLY and CHECK, not background reading.

Matter facts are in the supplied material. Say where to retrieve and reconcile them; never put
presumed facts into the harness.

Do not diagnose commands, retries, reading order, output paths, budgeting, scripts or hooks. A
parallel candidate owns procedure; stay on practitioner knowledge.`,
}

/**
 * The proposer's final message: the notes it replied with.
 *
 * The notes are read by a person, not applied by a machine, so they are returned as text
 * rather than parsed.
 * @param reply - the proposer's final assistant text.
 * @returns the contents of its `<notes>` block, or the whole reply when it has none.
 */
export function extractNotes(reply: string): string {
  const match = /<notes>([\s\S]*?)<\/notes>/.exec(reply)
  return match === null ? reply.trim() : (match[1] ?? '').trim()
}

/**
 * Whether a proposal kept the base harness unchanged.
 *
 * This is a real answer, not a failure: adaptation the evidence does not support costs context
 * and buys nothing.
 * @param reply - the proposer's final assistant text.
 * @returns whether the proposer said `KEEP_BASE`.
 */
export function isKeepBase(reply: string): boolean {
  return /\bKEEP_BASE\b/.test(reply)
}
