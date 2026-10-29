import { describe, expect, it } from 'vitest'

import {
  DEFAULT_MIN_SCORE,
  DEFAULT_TOP_N,
  jaccard,
  renderLessons,
  retrieve,
  sharedTokens,
  tokenize,
  type Experience,
  type Retrievable,
} from '../src/index.ts'

const CUE_TOOL: Experience = {
  cue: 'when a tool times out on a large file',
  lesson: 'read the file in chunks, in the helper script',
  evidence: 'the base rollout burned its budget on one read',
}

const CUE_SHAPE: Experience = {
  cue: 'when a figure appears in both a filing and a spreadsheet',
  lesson: 'reconcile every figure against the authoritative source',
  evidence: 'two rollouts disagreed on one figure; the reconciled one matched',
}

const ENTRIES: Retrievable[] = [
  { taskId: 'task-tool', experience: CUE_TOOL },
  { taskId: 'task-shape', experience: CUE_SHAPE },
]

describe('tokenize', () => {
  it('lowercases and drops short fragments', () => {
    expect(tokenize('A Tool Times Out')).toEqual(['out', 'times', 'tool'])
  })

  it('drops numbers, which match a task without naming a situation', () => {
    expect(tokenize('the fee rose to 250 on January')).not.toContain('250')
  })
})

describe('jaccard', () => {
  it('is 1 for the same token set', () => {
    expect(jaccard(['a', 'b'], ['b', 'a'])).toBe(1)
  })

  it('is 0 for disjoint token sets', () => {
    expect(jaccard(['a'], ['b'])).toBe(0)
  })

  it('is 0 when either side is empty', () => {
    // An empty task and an empty cue share nothing; calling that a perfect match would
    // make the threshold meaningless.
    expect(jaccard([], [])).toBe(0)
    expect(jaccard(['a'], [])).toBe(0)
  })
})

describe('sharedTokens', () => {
  it('names the tokens both sides share', () => {
    expect(sharedTokens('a tool times out', 'the tool times out on a file'))
      .toEqual(['out', 'times', 'tool'])
  })
})

describe('retrieve', () => {
  it('finds the lesson whose cue names the same situation', () => {
    const matches = retrieve({
      task: 'the tool times out on a large file and the run is slow',
      entries: ENTRIES,
    })

    expect(matches).toHaveLength(1)
    expect(matches[0]?.taskId).toBe('task-tool')
  })

  it('returns nothing when no cue reaches the threshold', () => {
    const matches = retrieve({
      task: 'a question about the weather',
      entries: ENTRIES,
    })

    expect(matches).toEqual([])
  })

  it('returns the best match first', () => {
    const matches = retrieve({
      task: 'a large file makes the tool time out; a figure appears in a spreadsheet too',
      entries: ENTRIES,
    })

    expect(matches.length).toBeGreaterThan(1)
    expect(matches[0]?.score).toBeGreaterThanOrEqual(matches[1]?.score ?? 0)
  })

  it('returns at most the requested number of lessons', () => {
    const matches = retrieve({
      task: 'a large file makes the tool time out; a figure appears in a spreadsheet too',
      entries: ENTRIES,
      topN: 1,
    })

    expect(matches).toHaveLength(1)
  })

  it('honours the threshold the caller sets', () => {
    const loose = retrieve({ task: 'file tool', entries: ENTRIES, minScore: 0 })
    const strict = retrieve({ task: 'file tool', entries: ENTRIES, minScore: 0.99 })

    expect(loose.length).toBeGreaterThan(0)
    expect(strict).toEqual([])
  })

  it('sorts equal scores by task id, so the same library always answers the same way', () => {
    const tied: Retrievable[] = [
      { taskId: 'task-b', experience: CUE_TOOL },
      { taskId: 'task-a', experience: CUE_TOOL },
    ]
    const matches = retrieve({ task: 'a large file makes the tool time out', entries: tied })

    expect(matches.map(match => match.taskId)).toEqual(['task-a', 'task-b'])
  })

  it('scores on the cue rather than on the lesson', () => {
    // The lesson is long and specific; the cue is the shape of the situation. Scoring on
    // the lesson would match a task against a lesson's wording.
    const entries: Retrievable[] = [{
      taskId: 'task-1',
      experience: {
        cue: 'weather forecasting',
        lesson: 'read the file in chunks, in the helper script',
        evidence: 'a contrast',
      },
    }]
    const matches = retrieve({ task: 'read the file in chunks', entries })

    expect(matches).toEqual([])
  })

  it('carries the shared tokens so a reader can judge the match', () => {
    const matches = retrieve({ task: 'the tool times out', entries: ENTRIES })
    expect(matches[0]?.shared).toContain('tool')
  })

  it('defaults to the documented threshold and depth', () => {
    expect(DEFAULT_MIN_SCORE).toBe(0.12)
    expect(DEFAULT_TOP_N).toBe(3)
  })
})

describe('renderLessons', () => {
  it('renders the cue and the lesson of every match', () => {
    const matches = retrieve({ task: 'the tool times out', entries: ENTRIES })
    const rendered = renderLessons(matches)

    expect(rendered).toContain(CUE_TOOL.cue)
    expect(rendered).toContain(CUE_TOOL.lesson)
  })

  it('leaves the evidence out, which is too long for a prompt', () => {
    const matches = retrieve({ task: 'the tool times out', entries: ENTRIES })
    expect(renderLessons(matches)).not.toContain(CUE_TOOL.evidence)
  })

  it('renders nothing when nothing matched', () => {
    expect(renderLessons([])).toBe('')
  })
})
