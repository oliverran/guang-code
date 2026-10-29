/**
 * The evidence tree: one directory a proposer reads instead of an inlined prompt.
 *
 * Layout mirrors what a Propose stage needs and nothing more:
 *
 * ```text
 * <root>/task.md                the task as the agent received it
 * <root>/source/                material the work was done against
 * <root>/rollouts/<label>.md    full trajectory, no prompt-budget truncation
 * <root>/deliverables/<label>/  what that run produced
 * <root>/harness/               the component tree being edited
 * <root>/library/INDEX.md       earlier adopted harnesses in this domain
 * <root>/pool/<label>/          one candidate: its harness diff, rollout, and output
 * ```
 *
 * Evidence is served as files and the mission is a short pointer, so nothing is truncated to fit a
 * prompt. The boundary declaration is prepended to each trajectory file rather than to the
 * mission: a proposer that opens one file must see the warning there, not only in the index.
 *
 * @module
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { SessionEvent } from '@deepseek-ai/dsh-session'

import type { EvidenceContents, EvidenceMission, EvidenceRollout } from './types.ts'
import { EVIDENCE_BOUNDARY } from './types.ts'
import { clip, type RenderBudget, renderTrajectory, turnReason } from './render.ts'

/** What one caller supplies to build a tree. */
export interface EvidenceInput {
  /** Task id; also the directory name under the caller's root. */
  readonly taskId: string
  /** The task text as the agent received it. */
  readonly task: string
  /** Source material the work was done against, filename to text. */
  readonly source?: Readonly<Record<string, string>>
  /** One entry per rollout that ran. */
  readonly rollouts: readonly EvidenceRollout[]
  /** Harness tree to edit, relative path to content. Absent means `harness/` is not written. */
  readonly harness?: Readonly<Record<string, string>>
  /** Earlier adopted harnesses for this domain, relative path to content. */
  readonly library?: Readonly<Record<string, string>>
  /** Candidate pools for the compose stage, keyed by label. */
  readonly pool?: readonly EvidenceCandidate[]
}

/** One candidate's evidence: what it changed and what it produced. */
export interface EvidenceCandidate {
  readonly label: string
  /** Its harness tree, relative path to content. */
  readonly harness: Readonly<Record<string, string>>
  /** Unified diff against the current harness, already computed by the caller. */
  readonly diff: string
  /** Its rendered trajectory. */
  readonly trajectory: string
  /** What it produced, as text. */
  readonly produced: string
}

/** What a caller needs to describe the tree it just wrote. */
export interface EvidenceTree extends EvidenceContents {
  /** Absolute root that was written. */
  readonly root: string
  /** The prompt-facing pointer plus the boundary declaration. */
  readonly mission: EvidenceMission
}

/** Skip any tree entry that is not readable text, so one bad file cannot fail the build. */
async function writeTree(root: string, tree: Readonly<Record<string, string>>): Promise<number> {
  let written = 0
  for (const [rel, body] of Object.entries(tree)) {
    const parts = rel.split('/')
    // A harness entry is caller-authored text, and `..` would either escape this directory or
    // silently land the file somewhere the caller never named. Reject the entry either way.
    if (parts.some(part => part === '..')) continue
    const segments = parts.filter(part => part && part !== '.')
    if (!segments.length) continue
    const target = join(root, ...segments)
    try {
      await mkdir(join(target, '..'), { recursive: true })
      await writeFile(target, body, 'utf8')
      written++
    } catch {
      // A harness entry that cannot be written is a proposal defect, not a crash: the caller's
      // validation already rejected the tree, and the stage falls back rather than aborting.
    }
  }
  return written
}

/** Filename-safe form of a label; a label is caller-chosen and may contain separators. */
function safeName(label: string): string {
  return label.replace(/[^A-Za-z0-9._-]+/g, '__') || 'unnamed'
}

/**
 * Build one evidence tree under `parent` and return what landed.
 *
 * Trajectories arrive already rendered: a file is read by a model that opens it, so nothing is
 * clipped to fit a prompt here. A trajectory that failed to render is still written, with the
 * failure as its body: "this run produced nothing readable" is itself the finding a proposer needs.
 * @param parent - directory that will hold the tree; it must already exist.
 * @param input - the task, its rollouts, and any tree content to write alongside them.
 * @returns what landed, the absolute root written, and the mission describing it.
 */
export async function buildEvidence(
  parent: string,
  input: EvidenceInput,
): Promise<EvidenceTree> {
  const root = join(parent, safeName(input.taskId))
  await rm(root, { recursive: true, force: true })
  await mkdir(join(root, 'rollouts'), { recursive: true })

  await writeFile(join(root, 'task.md'), input.task, 'utf8')

  let source = false
  if (input.source && Object.keys(input.source).length) {
    source = (await writeTree(join(root, 'source'), input.source)) > 0
  }

  const gotRollouts: string[] = []
  const failed: string[] = []
  const deliverables: Record<string, readonly string[]> = {}
  for (const rollout of input.rollouts) {
    const name = safeName(rollout.label)
    const body = rollout.trajectory.includes('[USER]')
      || rollout.trajectory.includes('[ASSISTANT]')
      || rollout.trajectory.includes('[OBSERVATION]')
      || rollout.trajectory.includes('[ACTION]')
      ? rollout.trajectory
      : `(no readable trajectory: ${rollout.trajectory})`
    await writeFile(join(root, 'rollouts', `${name}.md`), `${EVIDENCE_BOUNDARY}\n${body}`, 'utf8')
    if (body.startsWith('(no readable')) failed.push(rollout.label)
    else gotRollouts.push(rollout.label)

    const files = Object.entries(rollout.deliverables)
    // A label is recorded only when it actually produced files. The layout names
    // `deliverables/<label>/` as existing only when the directory does, because a
    // proposer that is sent to a directory the tree never wrote comes back
    // empty-handed and concludes it has no evidence.
    if (files.length) {
      deliverables[rollout.label] = files.map(([file]) => file)
      await writeTree(join(root, 'deliverables', name), Object.fromEntries(files))
      await writeFile(
        join(root, 'deliverables', name, 'INDEX.md'),
        `# ${rollout.label} produced ${files.length} file(s)\n\n`
        + files.map(([file, text]) => `- \`${file}\`  (${text.length.toLocaleString('en-US')} chars)`).join('\n')
        + '\n',
        'utf8',
      )
    }
  }

  let harnessFiles = 0
  if (input.harness) harnessFiles = await writeTree(join(root, 'harness'), input.harness)

  let library = false
  if (input.library && Object.keys(input.library).length) {
    library = (await writeTree(join(root, 'library'), input.library)) > 0
  }

  const pool: string[] = []
  if (input.pool?.length) {
    for (const candidate of input.pool) {
      const dir = join(root, 'pool', safeName(candidate.label))
      await mkdir(dir, { recursive: true })
      await writeTree(join(dir, 'harness'), candidate.harness)
      await writeFile(join(dir, 'harness.diff'), candidate.diff, 'utf8')
      await writeFile(join(dir, 'rollout.md'), `${EVIDENCE_BOUNDARY}\n${candidate.trajectory}`, 'utf8')
      await writeFile(join(dir, 'produced.md'), candidate.produced, 'utf8')
      pool.push(candidate.label)
    }
  }

  const contents: EvidenceContents = {
    rollouts: gotRollouts,
    failed,
    harnessFiles,
    library,
    source,
    pool,
    deliverables,
  }
  return { ...contents, root, mission: missionFor(contents) }
}

/**
 * The prompt-facing index. It names only what exists, so a proposer is never sent to read a
 * directory that was not written.
 *
 * The paths are relative to the tree root, so the mission names them exactly as they sit on
 * disk: a listing that says `context/rollouts/` when the directory is `rollouts/` sends the
 * proposer to a path that does not exist.
 * @param contents - what one evidence tree actually holds.
 * @returns the layout listing to hand the model, plus the boundary declaration.
 */
export function missionFor(contents: EvidenceContents): EvidenceMission {
  const lines = ['task.md                the task as the agent received it']
  if (contents.source) {
    lines.push('source/                material the work was done against')
  }
  if (contents.rollouts.length) {
    const shown = contents.rollouts.slice(0, 6).map(label => `${safeName(label)}.md`).join(', ')
    const more = contents.rollouts.length > 6
      ? ` (+${contents.rollouts.length - 6} more)`
      : ''
    lines.push(`rollouts/              FULL trajectories: ${shown}${more}`)
  }
  if (Object.keys(contents.deliverables).length) {
    lines.push('deliverables/<label>/  the files each rollout produced')
  }
  if (contents.harnessFiles) {
    lines.push(`harness/               the harness you are editing (${contents.harnessFiles} files)`)
  }
  if (contents.library) {
    lines.push('library/               earlier adopted harnesses in this area — browse INDEX.md first')
  }
  if (contents.pool.length) {
    lines.push('pool/<label>/          candidate harness, its diff, its rollout, its output')
  }
  return { layout: lines.join('\n'), boundary: EVIDENCE_BOUNDARY }
}

/**
 * Read one labelled trajectory back, for a stage that re-opens what an earlier one wrote.
 * @param root - the evidence tree root written by {@link buildEvidence}.
 * @param label - the rollout label as the caller named it, not the sanitised filename.
 * @returns the file body including its boundary declaration, or undefined when no such rollout exists.
 */
export async function readRollout(root: string, label: string): Promise<string | undefined> {
  const path = join(root, 'rollouts', `${safeName(label)}.md`)
  return readFile(path, 'utf8').catch(() => undefined)
}

/**
 * Render one session's events into the file body a proposer reads.
 * @param events - a session's raw log events.
 * @param budget - per-cell and whole-render truncation limits.
 * @returns the rendered trajectory preceded by the evidence boundary declaration.
 */
export function trajectoryFile(events: readonly SessionEvent[], budget: RenderBudget): string {
  return `${EVIDENCE_BOUNDARY}\n${renderTrajectory(events, budget)}`
}

/**
 * Whether a run counts as delivered: only a `completed` turn is a result, not a zero.
 * @param events - a session's raw log events.
 * @returns whether the last turn closed as `completed`.
 */
export function delivered(events: readonly SessionEvent[]): boolean {
  return turnReason(events) === 'completed'
}

/**
 * One-line summary of a run, for logs and library entries.
 * @param rollout - the rollout to summarise.
 * @returns the label, its turn reason, whether it delivered, and its first non-empty line.
 */
export function summarise(rollout: EvidenceRollout): string {
  const head = clip(rollout.trajectory.split('\n').find(line => line.trim()) ?? '', 120)
  return `${rollout.label}: turn=${rollout.turnReason} delivered=${rollout.delivered} ${head}`
}
