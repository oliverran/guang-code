/**
 * Retrieval over the library: which earlier lessons apply to the task in front of us.
 *
 * The scorer is lexical — the Jaccard overlap between the task's tokens and a lesson's
 * `cue`. That is a deliberate choice, not a placeholder:
 *
 * - It is explainable. A reader can see exactly which words matched and decide whether the
 *   match is real, which a semantic score cannot offer.
 * - It is free. No model call, no embedding index, no network.
 * - It is enough at library scale. A domain holds a handful of entries, and the thing
 *   retrieval has to get right is "is this lesson about the same situation at all" — a
 *   question word overlap answers long before a semantic model is worth its latency.
 *
 * The threshold and the depth are the caller's, because "how similar is similar enough"
 * is a property of the domain, not of the algorithm.
 *
 * @module
 */

import type { Experience } from './experience.ts'

/** The default similarity a lesson must reach to be retrieved. */
export const DEFAULT_MIN_SCORE = 0.12

/** The default number of lessons one retrieval returns. */
export const DEFAULT_TOP_N = 3

/** One lesson the library holds, with the task it was learned in. */
export interface Retrievable {
  /** The task id the lesson was learned in. */
  readonly taskId: string
  /** The lesson itself. */
  readonly experience: Experience
}

/** One retrieved lesson, with the score that selected it. */
export interface Match {
  /** The task id the lesson was learned in. */
  readonly taskId: string
  /** The lesson itself. */
  readonly experience: Experience
  /** The lexical similarity between the task and the lesson's cue. */
  readonly score: number
  /** The tokens both sides shared. */
  readonly shared: readonly string[]
}

/** How one retrieval is configured. */
export interface RetrieveOptions {
  /** The task text to match against. */
  readonly task: string
  /** The lessons the library holds. */
  readonly entries: readonly Retrievable[]
  /** The similarity a lesson must reach. */
  readonly minScore?: number
  /** How many lessons to return. */
  readonly topN?: number
}

/**
 * The word tokens of a text.
 *
 * The tokens are lowercased, and punctuation and digits-only fragments are dropped: a
 * lesson's cue and a task's text match on WORDS, and a shared number or a shared
 * hyphen is noise that inflates the score without naming a situation.
 * @param text - the text to tokenize.
 * @returns the distinct tokens, sorted.
 */
export function tokenize(text: string): string[] {
  const found = new Set<string>()
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3) continue
    if (/^\d+$/.test(raw)) continue
    found.add(raw)
  }
  return [...found].sort()
}

/**
 * The Jaccard similarity of two token sets.
 *
 * Two empty sets are defined as zero similarity: an empty task and an empty cue share
 * nothing, and calling that a perfect match would make the threshold meaningless.
 * @param left - the first token set.
 * @param right - the second token set.
 * @returns the similarity, between 0 and 1.
 */
export function jaccard(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 || right.length === 0) return 0
  const rightSet = new Set(right)
  let shared = 0
  for (const token of left) {
    if (rightSet.has(token)) shared += 1
  }
  // The union holds at least the larger of the two non-empty sets, so it is never zero
  // here; the empty case was answered above.
  return shared / new Set([...left, ...right]).size
}

/**
 * The tokens two texts share.
 * @param left - the first text.
 * @param right - the second text.
 * @returns the shared tokens, sorted.
 */
export function sharedTokens(left: string, right: string): string[] {
  const rightSet = new Set(tokenize(right))
  return tokenize(left).filter(token => rightSet.has(token))
}

/**
 * Find the lessons that apply to a task.
 *
 * The lessons are scored on their `cue` alone. The `cue` is the shape of the situation,
 * so it is the part that says whether the lesson applies; the `lesson` says what to do
 * and is long and specific, so scoring on it would match a task against a lesson's
 * wording rather than against its situation.
 *
 * The result is sorted by score, and ties are broken by task id, so the same library and
 * the same task always return the same lessons in the same order.
 * @param options - the task, the lessons, the threshold, and the depth.
 * @returns the matching lessons, best first.
 */
export function retrieve(options: RetrieveOptions): Match[] {
  const minScore = options.minScore ?? DEFAULT_MIN_SCORE
  const topN = options.topN ?? DEFAULT_TOP_N
  const taskTokens = tokenize(options.task)
  const matches: Match[] = []
  for (const entry of options.entries) {
    const cue = entry.experience.cue
    const score = jaccard(taskTokens, tokenize(cue))
    if (score < minScore) continue
    matches.push({
      taskId: entry.taskId,
      experience: entry.experience,
      score,
      shared: sharedTokens(options.task, cue),
    })
  }
  matches.sort((left, right) => right.score - left.score || left.taskId.localeCompare(right.taskId))
  return matches.slice(0, topN)
}

/**
 * Render the retrieved lessons as the text a later task is given.
 *
 * Only the `cue` and the `lesson` are rendered. The `evidence` is a citation of specific
 * rollout moments and runs to hundreds of words, which is far too much context to spend
 * on a hint; a reader that needs the detail opens the entry in the library.
 * @param matches - the retrieved lessons.
 * @returns the rendered text, or an empty string when nothing matched.
 */
export function renderLessons(matches: readonly Match[]): string {
  if (matches.length === 0) return ''
  const lines = ['# EARLIER ADOPTED HARNESSES IN THIS AREA', '']
  for (const match of matches) {
    lines.push(`- (${match.experience.cue}) ${match.experience.lesson}`)
  }
  lines.push('', 'These are lessons from earlier tasks in this area, not instructions for this task. Read the library entry before reusing a component from it, and re-verify anything it asserts about a workspace: there it was a fact, here it is a hypothesis.')
  return lines.join('\n')
}
