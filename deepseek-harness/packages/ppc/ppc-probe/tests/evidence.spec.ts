import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { EVIDENCE_BOUNDARY, buildEvidence } from '@deepseek-ai/dsh-ppc-evidence'
import { DSH_SURFACE } from '@deepseek-ai/dsh-ppc-surface'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { describe, expect, it } from 'vitest'

import { hasReadableEvents, probeCandidate, probeEvidence, producedBody, runProbes } from '../src/index.ts'

const BASE = {
  'PERSONA.md': 'You are precise.',
  'AGENTS.md': 'You are a coding agent.',
}

const CANDIDATE = {
  'PERSONA.md': 'You are precise.',
  'AGENTS.md': 'You are a coding agent.\nAlways run the tests.',
}

const BUDGET = { obsTrunc: 50_000, argsTrunc: 2_000, maxChars: 200_000 }

async function scratch(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'dsh-ppc-probe-'))
}

async function probeHarness(adapter: MockAdapter): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

describe('hasReadableEvents', () => {
  it('tells a trajectory from a failed render', () => {
    expect(hasReadableEvents('[USER] fix it')).toBe(true)
    expect(hasReadableEvents('[ACTION] bash({})')).toBe(true)
    expect(hasReadableEvents('(no parseable events in trajectory)')).toBe(false)
  })
})

describe('producedBody', () => {
  it('reports what the agent said', async () => {
    const root = await scratch()
    const adapter = new MockAdapter([textResponse('the answer')])
    const ctx = await probeHarness(adapter)
    const run = await runProbes(ctx, {
      surface: DSH_SURFACE,
      task: 'do the thing',
      candidates: [{ label: 'inv1', tree: BASE }],
      root: join(root, 'probes'),
      agentOptions: { provider: 'mock', model: 'mock' },
      timeoutMs: 10_000,
      concurrency: 1,
      signal: new AbortController().signal,
    })

    expect(producedBody(run.results[0]!)).toBe('the answer')
  })

  it('says why a probe produced nothing', async () => {
    const root = await scratch()
    const adapter = new MockAdapter([textResponse('partial')])
    const ctx = await probeHarness(adapter)
    const run = await runProbes(ctx, {
      surface: DSH_SURFACE,
      task: 'do the thing',
      candidates: [{ label: 'inv1', tree: BASE }],
      root: join(root, 'probes'),
      agentOptions: { provider: 'mock', model: 'mock' },
      timeoutMs: 10_000,
      concurrency: 1,
      signal: new AbortController().signal,
    })

    // A probe that produced no text is not a probe that produced a zero: it is a run that
    // ended before the agent answered, and the reason is the finding.
    const result = { ...run.results[0]!, output: '' }
    expect(producedBody(result)).toContain('the turn ended as')
  })

  it('names the failure when a probe produced nothing', async () => {
    const root = await scratch()
    const adapter = new MockAdapter([textResponse('the answer')])
    const ctx = await probeHarness(adapter)
    const run = await runProbes(ctx, {
      surface: DSH_SURFACE,
      task: 'do the thing',
      candidates: [{ label: 'inv1', tree: BASE }],
      root: join(root, 'probes'),
      agentOptions: { provider: 'mock', model: 'mock' },
      timeoutMs: 10_000,
      concurrency: 1,
      signal: new AbortController().signal,
    })

    // A failed probe produces no text either, but its finding is the failure itself, not
    // merely the turn reason.
    const result = { ...run.results[0]!, output: '', error: 'the probe ran out of time' }
    expect(producedBody(result)).toBe('(the probe failed: the probe ran out of time)')
  })
})

describe('probeCandidate', () => {
  it('carries the candidate harness, its diff, its rollout and its output', async () => {
    const root = await scratch()
    const adapter = new MockAdapter([textResponse('the answer')])
    const ctx = await probeHarness(adapter)
    const run = await runProbes(ctx, {
      surface: DSH_SURFACE,
      task: 'do the thing',
      candidates: [{ label: 'inv1', tree: CANDIDATE }],
      root: join(root, 'probes'),
      agentOptions: { provider: 'mock', model: 'mock' },
      timeoutMs: 10_000,
      concurrency: 1,
      signal: new AbortController().signal,
    })

    const candidate = probeCandidate(run.results[0]!, BASE, BUDGET)

    expect(candidate.label).toBe('inv1')
    expect(candidate.harness).toEqual(CANDIDATE)
    expect(candidate.diff).toContain('+Always run the tests.')
    expect(candidate.produced).toBe('the answer')
    expect(candidate.trajectory).toContain('[ASSISTANT] the answer')
  })
})

describe('probeEvidence', () => {
  it('hands the sweep over as rollouts and candidates', async () => {
    const root = await scratch()
    const adapter = new MockAdapter([textResponse('a'), textResponse('b')])
    const ctx = await probeHarness(adapter)
    const run = await runProbes(ctx, {
      surface: DSH_SURFACE,
      task: 'do the thing',
      candidates: [
        { label: 'inv1', tree: CANDIDATE },
        { label: 'dom1', tree: BASE },
      ],
      root: join(root, 'probes'),
      agentOptions: { provider: 'mock', model: 'mock' },
      timeoutMs: 10_000,
      concurrency: 2,
      signal: new AbortController().signal,
    })

    const evidence = probeEvidence(run.results, BASE, BUDGET)

    expect(evidence.rollouts.map(rollout => rollout.label)).toEqual(['inv1', 'dom1'])
    expect(evidence.rollouts.every(rollout => rollout.delivered)).toBe(true)
    expect(evidence.candidates.map(candidate => candidate.label)).toEqual(['inv1', 'dom1'])
    // The base candidate's diff against the base is empty: it changed nothing.
    expect(evidence.candidates[1]!.diff).toBe('')
    expect(evidence.candidates[0]!.diff).not.toBe('')
  })

  it('writes a sweep into an evidence tree a later stage can read', async () => {
    const root = await scratch()
    const adapter = new MockAdapter([textResponse('the answer')])
    const ctx = await probeHarness(adapter)
    const run = await runProbes(ctx, {
      surface: DSH_SURFACE,
      task: 'do the thing',
      candidates: [{ label: 'inv1', tree: CANDIDATE }],
      root: join(root, 'probes'),
      agentOptions: { provider: 'mock', model: 'mock' },
      timeoutMs: 10_000,
      concurrency: 1,
      signal: new AbortController().signal,
    })

    const evidence = probeEvidence(run.results, BASE, BUDGET)
    const tree = await buildEvidence(root, {
      taskId: 'task-1',
      task: 'do the thing',
      rollouts: [...evidence.rollouts],
      harness: BASE,
      pool: [...evidence.candidates],
    })

    // The pool entry carries the candidate's harness, its diff, its rollout and its output.
    const diff = await readFile(join(tree.root, 'pool', 'inv1', 'harness.diff'), 'utf8')
    expect(diff).toContain('+Always run the tests.')
    const rollout = await readFile(join(tree.root, 'pool', 'inv1', 'rollout.md'), 'utf8')
    expect(rollout.startsWith(EVIDENCE_BOUNDARY)).toBe(true)
    expect(rollout).toContain('[ASSISTANT] the answer')
    const produced = await readFile(join(tree.root, 'pool', 'inv1', 'produced.md'), 'utf8')
    expect(produced).toBe('the answer')

    // The rollout index carries the same run.
    const indexed = await readFile(join(tree.root, 'rollouts', 'inv1.md'), 'utf8')
    expect(indexed).toContain('[ASSISTANT] the answer')
    expect(tree.rollouts).toEqual(['inv1'])
    expect(tree.pool).toEqual(['inv1'])
  })
})
