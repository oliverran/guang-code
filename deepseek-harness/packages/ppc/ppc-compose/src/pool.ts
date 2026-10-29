/**
 * The anonymous candidate pool: the directory a selector reads.
 *
 * The pool is the whole point of the compose stage, so its shape is deliberately narrow.
 * A selector that can tell which candidate came from the unmodified harness and which came
 * from an adapted one is not choosing between outputs — it is choosing a story about how
 * they were made. So the pool holds:
 *
 * - the TASK, verbatim;
 * - the SOURCE material the work was done from, when the caller has one;
 * - one file per candidate, named by its anonymous id, holding what that run PRODUCED.
 *
 * What the pool does NOT hold is what would void the anonymity: a candidate's harness, its
 * diff against the base, its rollout, and its label. A diff says "this one was adapted"
 * outright, and a rollout shows the harness's own instructions; either one turns a blind
 * choice into a judgement about the harness. The candidate's own output is what the
 * selector is asked to judge, and that is all it gets.
 *
 * @module
 */

import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { buildPool } from './anonymity.ts'
import type { PoolEntry } from './anonymity.ts'

/** One candidate offered to the selector. */
export interface PoolCandidate {
  /** The candidate's own label. It never reaches the pool directory. */
  readonly label: string
  /** What the candidate produced, which is what the selector judges. */
  readonly produced: string
  /** Whether the candidate's run ended as a completed turn. */
  readonly delivered: boolean
}

/** How one pool is written. */
export interface PoolOptions {
  /** The directory the pool is written to; it is replaced. */
  readonly root: string
  /** The task text as the agent received it. */
  readonly task: string
  /** The candidates, each with its label and what it produced. */
  readonly candidates: readonly PoolCandidate[]
  /** Source material the work was done against, filename to text. */
  readonly source?: Readonly<Record<string, string>>
  /** The seed the anonymous ids are derived from; the same seed gives the same ids. */
  readonly seed: string
}

/** One candidate that did not reach the pool, and why. */
export interface DroppedCandidate {
  /** The candidate's own label. */
  readonly label: string
  /** Why it was dropped. */
  readonly reason: string
}

/** What the pool directory holds and what the mission names. */
export interface SelectionPool {
  /** The directory the pool was written to. */
  readonly root: string
  /** The pool entries, in anonymous-id order. */
  readonly entries: readonly PoolEntry[]
  /** The anonymous ids, in the order they were assigned. */
  readonly ids: readonly string[]
  /** The candidates that did not make the pool, and why. */
  readonly dropped: readonly DroppedCandidate[]
  /** The listing the mission names, naming only what exists. */
  readonly layout: string
}

/**
 * Write the anonymous pool and describe what landed.
 *
 * A candidate that produced nothing is not an answer, so it never enters the pool: the
 * selector would be asked to choose between an output and a failure, and a failure wins
 * no criteria. The drop is recorded rather than silent, because "the candidate that
 * looked best never got a chance" is a finding about the probe, not a fact about the pool.
 * @param options - the task, the candidates, the source material, and the seed.
 * @returns the pool, its entries, the drops, and the listing the mission names.
 */
export async function writePool(options: PoolOptions): Promise<SelectionPool> {
  const dropped: DroppedCandidate[] = []
  const answers: { label: string; produced: string }[] = []
  for (const candidate of options.candidates) {
    if (!candidate.delivered) {
      dropped.push({ label: candidate.label, reason: 'the run did not deliver a completed turn' })
      continue
    }
    if (candidate.produced.trim().length === 0) {
      dropped.push({ label: candidate.label, reason: 'the run produced no output' })
      continue
    }
    answers.push({ label: candidate.label, produced: candidate.produced })
  }

  const entries = buildPool(answers, options.seed)
  const ids = entries.map(entry => entry.id)

  await rm(options.root, { recursive: true, force: true })
  await mkdir(join(options.root, 'candidates'), { recursive: true })
  await writeFile(join(options.root, 'task.md'), options.task, 'utf8')

  let hasSource = false
  for (const [name, body] of Object.entries(options.source ?? {})) {
    const target = join(options.root, 'source', name)
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, body, 'utf8')
    hasSource = true
  }

  for (const entry of entries) {
    const body = entry.produced
    // The annotation says the file is COMPLETE, so a selector never mistakes a short
    // file for a truncated one. It is labelled as an annotation because it is NOT part
    // of the candidate's deliverable — a selector that counted it as extra content
    // would be judging the comparison, not the work.
    const header = '<!-- ANNOTATION (not part of the candidate\'s output): this file is candidate '
      + `${entry.id}; ${body.length.toLocaleString('en-US')} chars, `
      + `${body.split('\n').length.toLocaleString('en-US')} lines; COMPLETE, nothing trimmed. -->\n`
    await writeFile(join(options.root, 'candidates', `${entry.id}.md`), header + body, 'utf8')
  }

  const lines = ['task.md              the request, verbatim']
  if (hasSource) lines.push('source/              the material the work was done from')
  lines.push(`candidates/<id>.md   what that run PRODUCED: ${ids.join(', ')}`)

  return { root: options.root, entries, ids, dropped, layout: lines.join('\n') }
}
