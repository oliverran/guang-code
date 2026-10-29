/**
 * A unified diff between two harness trees.
 *
 * The pool entry of an evidence tree shows a candidate's harness next to the harness it
 * was derived from. Without the diff a reader can only compare two file trees by hand, and
 * the difference that matters — which lines of the always-on text changed — is exactly the
 * part a reader is least likely to reconstruct.
 *
 * The diff is line-based and in the unified format `difflib.unified_diff` produces, because
 * that is the format the evidence trees this project mirrors already carry.
 *
 * @module
 */

import type { HarnessTree } from './validate.ts'

/** Context lines shown on each side of a change. */
const CONTEXT = 3

/**
 * The largest LCS table this diff builds, in cells.
 *
 * A harness tree is small — the always-on text is capped at a few thousand characters — so
 * the quadratic table is free. The cap exists so a pathologically large tree degrades into
 * a whole-file replacement instead of allocating an unbounded table.
 */
const MAX_CELLS = 1_000_000

/** One line of the edit script between two texts. */
interface EditOp {
  /** Whether the line is unchanged, removed, or added. */
  readonly kind: 'equal' | 'delete' | 'insert'
  /** The line's text, without its terminator. */
  readonly text: string
}

/** One contiguous change, with the context around it. */
interface Hunk {
  /** First old-file line the hunk covers. */
  readonly oldStart: number
  /** How many old-file lines the hunk covers. */
  readonly oldCount: number
  /** First new-file line the hunk covers. */
  readonly newStart: number
  /** How many new-file lines the hunk covers. */
  readonly newCount: number
  /** The hunk's lines, each prefixed with its kind. */
  readonly lines: readonly string[]
}

/** Split a text into lines without their terminators. */
function toLines(text: string): string[] {
  if (text.length === 0) return []
  return text.replace(/\n$/, '').split('\n')
}

/**
 * The edit script that turns `before` into `after`.
 *
 * The script is the longest common subsequence of the two texts, walked back into per-line
 * operations. Ties resolve toward deletion, so a replacement reads as "removed, then added"
 * — the same order `difflib` produces.
 * @param before - the old text.
 * @param after - the new text.
 * @returns the per-line operations, in order.
 */
function editScript(before: readonly string[], after: readonly string[]): EditOp[] {
  const n = before.length
  const m = after.length
  if (n * m > MAX_CELLS) {
    return [
      ...before.map(text => ({ kind: 'delete', text }) as const),
      ...after.map(text => ({ kind: 'insert', text }) as const),
    ]
  }
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    /* v8 ignore next -- i iterates 0..n-1, so table[i] exists */
    const row = table[i] ?? []
    /* v8 ignore next -- the table has n+1 rows, so table[i + 1] exists */
    const nextRow = table[i + 1] ?? []
    for (let j = m - 1; j >= 0; j--) {
      /* v8 ignore next -- j+1 never exceeds m, so nextRow[j + 1] exists */
      const diagonal = nextRow[j + 1] ?? 0
      row[j] = before[i] === after[j]
        ? diagonal + 1
        : Math.max(/* v8 ignore next -- j never reaches m */ nextRow[j] ?? 0, /* v8 ignore next -- j+1 never exceeds m */ row[j + 1] ?? 0)
    }
  }
  const ops: EditOp[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      /* v8 ignore next -- the loop guards i < n, so before[i] exists */
      ops.push({ kind: 'equal', text: before[i] ?? '' })
      i += 1
      j += 1
      continue
    }
    /* v8 ignore next -- i iterates 0..n-1, so table[i] exists */
    const row = table[i] ?? []
    /* v8 ignore next -- the table has n+1 rows, so table[i + 1] exists */
    const nextRow = table[i + 1] ?? []
    /* v8 ignore next -- nextRow has m+1 cells, so nextRow[j] exists */
    const down = nextRow[j] ?? 0
    /* v8 ignore next -- row has m+1 cells, so row[j + 1] exists */
    const right = row[j + 1] ?? 0
    if (down >= right) {
      /* v8 ignore next -- the loop guards i < n, so before[i] exists */
      ops.push({ kind: 'delete', text: before[i] ?? '' })
      i += 1
    } else {
      /* v8 ignore next -- the loop guards j < m, so after[j] exists */
      ops.push({ kind: 'insert', text: after[j] ?? '' })
      j += 1
    }
  }
  while (i < n) {
    /* v8 ignore next -- the loop guards i < n, so before[i] exists */
    ops.push({ kind: 'delete', text: before[i] ?? '' })
    i += 1
  }
  while (j < m) {
    /* v8 ignore next -- the loop guards j < m, so after[j] exists */
    ops.push({ kind: 'insert', text: after[j] ?? '' })
    j += 1
  }
  return ops
}

/**
 * Group an edit script into hunks with context on each side.
 *
 * Two changes closer than twice the context are one hunk: a reader sees one contiguous
 * region rather than two fragments that share no lines.
 * @param ops - the per-line operations.
 * @returns the hunks, in order; an unchanged text yields none.
 */
function toHunks(ops: readonly EditOp[]): Hunk[] {
  const changed = ops
    .map((op, index) => (op.kind === 'equal' ? -1 : index))
    .filter(index => index >= 0)
  if (changed.length === 0) return []
  const groups: number[][] = []
  for (const index of changed) {
    const last = groups[groups.length - 1]
    const previous = last?.[last.length - 1]
    if (last !== undefined && previous !== undefined && index - previous <= CONTEXT * 2) {
      last.push(index)
    } else {
      groups.push([index])
    }
  }
  return groups.map((group) => {
    /* v8 ignore next -- a group is created with at least one index, so group[0] exists */
    const first = group[0] ?? 0
    /* v8 ignore next -- every group is non-empty, so its last index exists */
    const last = group[group.length - 1] ?? first
    const from = Math.max(0, first - CONTEXT)
    const to = Math.min(ops.length - 1, last + CONTEXT)
    const slice = ops.slice(from, to + 1)
    let oldStart = 0
    let newStart = 0
    for (let index = 0; index < from; index++) {
      const kind = ops[index]?.kind
      if (kind !== 'insert') oldStart += 1
      if (kind !== 'delete') newStart += 1
    }
    let oldCount = 0
    let newCount = 0
    const lines: string[] = []
    for (const op of slice) {
      if (op.kind === 'equal') {
        oldCount += 1
        newCount += 1
        lines.push(` ${op.text}`)
      } else if (op.kind === 'delete') {
        oldCount += 1
        lines.push(`-${op.text}`)
      } else {
        newCount += 1
        lines.push(`+${op.text}`)
      }
    }
    return { oldStart: oldStart + 1, oldCount, newStart: newStart + 1, newCount, lines }
  })
}

/**
 * Format one range the way a unified diff header does: the count is omitted when it is
 * one, and a range that covers nothing starts at zero.
 */
function range(start: number, count: number): string {
  const first = count === 0 ? start - 1 : start
  return count === 1 ? `${first}` : `${first},${count}`
}

/**
 * The unified diff of one file's two versions.
 * @param before - the old text.
 * @param after - the new text.
 * @param name - the file's name, used in the header.
 * @param label - the candidate's label, used as the new side's prefix.
 * @returns the diff, or an empty string when the two texts are equal.
 */
function diffFile(before: string, after: string, name: string, label: string): string {
  if (before === after) return ''
  const hunks = toHunks(editScript(toLines(before), toLines(after)))
  if (hunks.length === 0) return ''
  const out = [`--- current/${name}`, `+++ ${label}/${name}`]
  for (const hunk of hunks) {
    out.push(`@@ -${range(hunk.oldStart, hunk.oldCount)} +${range(hunk.newStart, hunk.newCount)} @@`)
    out.push(...hunk.lines)
  }
  return `${out.join('\n')}\n`
}

/**
 * The unified diff of two harness trees.
 *
 * Every file the two trees disagree about appears, in sorted path order, so the diff is a
 * stable document: the same pair of trees always produces the same bytes.
 * @param base - the harness the candidate was derived from.
 * @param candidate - the candidate's harness.
 * @param label - the candidate's label, used as the new side's prefix.
 * @returns the diff, or an empty string when the two trees are equal.
 */
export function diffTree(base: HarnessTree, candidate: HarnessTree, label: string): string {
  const paths = [...new Set([...Object.keys(base), ...Object.keys(candidate)])].sort()
  const parts: string[] = []
  for (const path of paths) {
    parts.push(diffFile(base[path] ?? '', candidate[path] ?? '', path, label))
  }
  return parts.join('')
}
