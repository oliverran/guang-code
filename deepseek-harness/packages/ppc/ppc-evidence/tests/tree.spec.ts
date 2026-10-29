import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  buildEvidence,
  delivered,
  EVIDENCE_BOUNDARY,
  finalMessage,
  missionFor,
  readRollout,
  summarise,
  trajectoryFile,
  turnReason,
  withDeadline,
} from '../src/index.ts'
import type { EvidenceInput, EvidenceRollout } from '../src/index.ts'

const BUDGET = { obsTrunc: 50_000, argsTrunc: 2_000, maxChars: 200_000 }

async function scratch(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'dsh-ppc-evidence-'))
}

function rollout(over: Partial<EvidenceRollout> = {}): EvidenceRollout {
  return {
    label: 'base',
    sessionId: 's-1',
    trajectory: '[USER] fix it\n[ACTION] bash({"command":"pytest"})\n[OBSERVATION] 1 failed',
    deliverables: { 'out.md': 'delivered text' },
    delivered: true,
    turnReason: 'completed',
    ...over,
  }
}

function input(over: Partial<EvidenceInput> = {}): EvidenceInput {
  return { taskId: 'task-7', task: 'fix the bug', rollouts: [rollout()], ...over }
}

describe('buildEvidence', () => {
  it('writes the layout the mission promises', async () => {
    const parent = await scratch()
    const tree = await buildEvidence(parent, input({
      source: { 'notes.md': 'context' },
      harness: { 'AGENTS.md': 'rules', '.dsh/skills/s/SKILL.md': 'skill' },
      library: { 'INDEX.md': '# earlier' },
      pool: [{
        label: 'cand/1',
        harness: { 'AGENTS.md': 'better rules' },
        diff: '--- a\n+++ b',
        trajectory: '[ASSISTANT] done',
        produced: '42 tests passing',
      }],
    }))

    expect(tree.root).toBe(join(parent, 'task-7'))
    expect((await readdir(tree.root)).sort()).toEqual([
      'deliverables', 'harness', 'library', 'pool', 'rollouts', 'source', 'task.md',
    ])
    expect(await readFile(join(tree.root, 'task.md'), 'utf8')).toBe('fix the bug')
    expect(await readFile(join(tree.root, 'harness', 'AGENTS.md'), 'utf8')).toBe('rules')
    expect(await readFile(join(tree.root, 'harness', '.dsh', 'skills', 's', 'SKILL.md'), 'utf8'))
      .toBe('skill')
    expect(await readFile(join(tree.root, 'pool', 'cand__1', 'harness.diff'), 'utf8'))
      .toBe('--- a\n+++ b')
    expect(tree.harnessFiles).toBe(2)
    expect(tree.library).toBe(true)
  })

  it('separates a rendered rollout from one that failed to render', async () => {
    const tree = await buildEvidence(await scratch(), input({
      rollouts: [rollout(), rollout({ label: 'inv1', trajectory: '(no parseable events in trajectory)' })],
    }))

    expect(tree.rollouts).toEqual(['base'])
    expect(tree.failed).toEqual(['inv1'])
    // A failed render is still written: "nothing readable" is itself a finding.
    const broken = await readFile(join(tree.root, 'rollouts', 'inv1.md'), 'utf8')
    expect(broken).toBe(`${EVIDENCE_BOUNDARY}\n(no readable trajectory: (no parseable events in trajectory))`)
  })

  it('gives every trajectory the boundary declaration in the file itself', async () => {
    const tree = await buildEvidence(await scratch(), input())
    const body = await readFile(join(tree.root, 'rollouts', 'base.md'), 'utf8')
    expect(body.startsWith(EVIDENCE_BOUNDARY)).toBe(true)
    expect(body).toContain('[ACTION] bash({"command":"pytest"})')
    expect(await readRollout(tree.root, 'base')).toBe(body)
    expect(await readRollout(tree.root, 'nope')).toBeUndefined()
  })

  it('names only what it wrote in the mission', async () => {
    const bare = await buildEvidence(await scratch(), input())
    expect(bare.mission.layout).toContain('task.md')
    expect(bare.mission.layout).not.toContain('harness/')
    expect(bare.mission.layout).not.toContain('library/')
    expect(bare.mission.boundary).toBe(EVIDENCE_BOUNDARY)

    const full = await buildEvidence(await scratch(), input({
      harness: { 'AGENTS.md': 'rules' },
      library: { 'INDEX.md': '# earlier' },
    }))
    expect(full.mission.layout).toContain('harness/               the harness you are editing (1 files)')
    expect(full.mission.layout).toContain('library/')
  })

  it('names the directories as they sit on disk', async () => {
    // The listing is the proposer's map: a path it names must be the path that exists.
    const tree = await buildEvidence(await scratch(), input({
      source: { 'notes.md': 'context' },
      harness: { 'AGENTS.md': 'rules' },
      library: { 'INDEX.md': '# earlier' },
      pool: [{
        label: 'cand1',
        harness: { 'AGENTS.md': 'better' },
        diff: '--- a',
        trajectory: '[ASSISTANT] done',
        produced: 'ok',
      }],
    }))
    const root = tree.root
    for (const named of ['task.md', 'source/', 'rollouts/', 'harness/', 'library/', 'pool/']) {
      expect(tree.mission.layout).toContain(named)
    }
    // Every directory the listing names is a directory that exists.
    for (const dir of ['source', 'rollouts', 'harness', 'library', 'pool']) {
      expect(await readdir(join(root, dir))).toBeDefined()
    }
  })

  it('indexes deliverables and lists them in the mission', async () => {
    const tree = await buildEvidence(await scratch(), input({
      rollouts: [rollout({ deliverables: { 'a.md': 'aa', 'src/b.py': 'bbb' } })],
    }))
    expect(tree.deliverables).toEqual({ base: ['a.md', 'src/b.py'] })
    expect(await readFile(join(tree.root, 'deliverables', 'base', 'src', 'b.py'), 'utf8')).toBe('bbb')
    const index = await readFile(join(tree.root, 'deliverables', 'base', 'INDEX.md'), 'utf8')
    expect(index).toContain('- `a.md`  (2 chars)')
    expect(tree.mission.layout).toContain('deliverables/<label>/')
  })

  it('does not list deliverables for a rollout that produced none', async () => {
    // A proposer sent to a directory the tree never written comes back empty-handed
    // and concludes it has no evidence — so the layout names only what exists.
    const tree = await buildEvidence(await scratch(), input({
      rollouts: [rollout({ deliverables: {} })],
    }))
    expect(tree.deliverables).toEqual({})
    expect(tree.mission.layout).not.toContain('deliverables/')
  })

  it('replaces a stale tree for the same task id', async () => {
    const parent = await scratch()
    const first = await buildEvidence(parent, input({ harness: { 'OLD.md': 'stale' } }))
    await buildEvidence(parent, input({ harness: { 'NEW.md': 'fresh' } }))
    expect(await readdir(join(parent, 'task-7', 'harness'))).toEqual(['NEW.md'])
    expect(await readdir(first.root)).not.toContain('OLD.md')
  })

  it('writes under its own directory and rejects a traversal entry', async () => {
    const parent = await scratch()
    const tree = await buildEvidence(parent, input({
      harness: { '../escape.md': 'nope', 'a/../../escape.md': 'nope', 'a/../b.md': 'b', 'ok.md': 'yes' },
    }))
    expect(tree.harnessFiles).toBe(1)
    expect(await readdir(join(tree.root, 'harness'))).toEqual(['ok.md'])
    expect(await readdir(parent)).not.toContain('escape.md')
  })
})

describe('missionFor', () => {
  it('counts the rollouts it names and says how many it left out', () => {
    const many = Array.from({ length: 8 }, (_, i) => `r${i}`)
    // The filenames, not the labels: a proposer that is told "r0" has to guess whether
    // that is a directory or a file, and guessing wrong costs the whole rollout.
    expect(missionFor({
      rollouts: many, failed: [], harnessFiles: 0, library: false, source: false, pool: [],
      deliverables: {},
    }).layout).toContain('FULL trajectories: r0.md, r1.md, r2.md, r3.md, r4.md, r5.md (+2 more)')
  })

  it('names the pool only when there are candidates', () => {
    const without = missionFor({
      rollouts: [], failed: [], harnessFiles: 0, library: false, source: false, pool: [],
      deliverables: {},
    })
    expect(without.layout).not.toContain('pool/')
    const with_ = missionFor({
      rollouts: [], failed: [], harnessFiles: 0, library: false, source: false, pool: ['a'],
      deliverables: {},
    })
    expect(with_.layout).toContain('pool/<label>/')
  })
})

describe('trajectoryFile', () => {
  it('carries the boundary declaration ahead of the render', () => {
    const file = trajectoryFile([], BUDGET)
    expect(file).toBe(`${EVIDENCE_BOUNDARY}\n(no parseable events in trajectory)`)
  })
})

describe('delivered', () => {
  it('counts only a completed turn as delivered', () => {
    const turn = (kind: string) => [
      { type: 'turn/end', seq: 1, time: 1, data: { reason: { kind } } },
    ] as never
    expect(delivered(turn('completed'))).toBe(true)
    expect(delivered(turn('aborted'))).toBe(false)
    expect(delivered(turn('max_tokens'))).toBe(false)
  })
})

describe('summarise', () => {
  it('names the label, the turn, and the first thing the run said', () => {
    expect(summarise(rollout())).toBe(
      'base: turn=completed delivered=true [USER] fix it',
    )
  })

  it('says nothing rather than crashing on an empty trajectory', () => {
    expect(summarise(rollout({ trajectory: '' })))
      .toBe('base: turn=completed delivered=true ')
  })
})

describe('re-exports', () => {
  it('keeps the session helpers reachable from one module', () => {
    expect(typeof turnReason).toBe('function')
    expect(typeof finalMessage).toBe('function')
  })
})

describe('withDeadline', () => {
  it('returns the value when the work finishes in time', async () => {
    expect(await withDeadline(Promise.resolve('done'), 1000, new AbortController().signal, 'probe'))
      .toBe('done')
  })

  it('fails when the deadline passes, naming the stage that ran out of time', async () => {
    await expect(withDeadline(new Promise(() => {}), 10, new AbortController().signal, 'probe'))
      .rejects.toThrow(/the probe exceeded 10ms/)
  })

  it('fails when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(withDeadline(new Promise(() => {}), 1000, controller.signal, 'probe'))
      .rejects.toThrow(/the probe was cancelled/)
  })

  it('fails when the signal aborts while the wait is in flight', async () => {
    const controller = new AbortController()
    const waiting = withDeadline(new Promise(() => {}), 10_000, controller.signal, 'probe')
    controller.abort()
    await expect(waiting).rejects.toThrow(/the probe was cancelled/)
  })
})

describe('buildEvidence edge cases', () => {
  it('skips a tree entry that names no file', async () => {
    const tree = await buildEvidence(await scratch(), input({
      harness: { '.': 'x', './': 'y', 'real.md': 'z' },
    }))
    expect(tree.harnessFiles).toBe(1)
    expect(await readdir(join(tree.root, 'harness'))).toEqual(['real.md'])
  })

  it('names an unnamed tree rather than writing to the parent', async () => {
    const parent = await scratch()
    const tree = await buildEvidence(parent, input({ taskId: '' }))
    expect(tree.root).toBe(join(parent, 'unnamed'))
  })
})
