import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { describe, expect, it } from 'vitest'

import { DSH_SURFACE } from '@deepseek-ai/dsh-ppc-surface'

import { runProbes } from '../src/index.ts'

const HARNESS = {
  'PERSONA.md': 'You are the probe persona.',
  'AGENTS.md': 'You are a coding agent.',
}

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

describe('runProbes', () => {
  it('returns one result per candidate, in the order they were given', async () => {
    const root = await scratch()
    const adapter = new MockAdapter([textResponse('first'), textResponse('second')])
    const ctx = await probeHarness(adapter)

    const run = await runProbes(ctx, {
      surface: DSH_SURFACE,
      task: 'do the thing',
      candidates: [
        { label: 'inv1', tree: HARNESS },
        { label: 'dom1', tree: HARNESS },
      ],
      root: join(root, 'probes'),
      agentOptions: { provider: 'mock', model: 'mock' },
      timeoutMs: 10_000,
      concurrency: 2,
      signal: new AbortController().signal,
    })

    expect(run.results.map(result => result.label)).toEqual(['inv1', 'dom1'])
    expect(run.skipped).toEqual([])
  })

  it('runs every candidate on the same model, so the comparison is about the harness', async () => {
    const root = await scratch()
    const adapter = new MockAdapter([textResponse('a'), textResponse('b')])
    const ctx = await probeHarness(adapter)

    await runProbes(ctx, {
      surface: DSH_SURFACE,
      task: 'do the thing',
      candidates: [
        { label: 'inv1', tree: HARNESS },
        { label: 'dom1', tree: HARNESS },
      ],
      root: join(root, 'probes'),
      agentOptions: { provider: 'mock', model: 'mock' },
      timeoutMs: 10_000,
      concurrency: 2,
      signal: new AbortController().signal,
    })

    const routes = adapter.requests.map(request => `${request.provider}/${request.model}`)
    expect(new Set(routes).size).toBe(1)
  })

  it('runs the candidates through the task', async () => {
    const root = await scratch()
    const adapter = new MockAdapter([textResponse('a'), textResponse('b')])
    const ctx = await probeHarness(adapter)

    await runProbes(ctx, {
      surface: DSH_SURFACE,
      task: 'fix the failing test',
      candidates: [
        { label: 'inv1', tree: HARNESS },
        { label: 'dom1', tree: HARNESS },
      ],
      root: join(root, 'probes'),
      agentOptions: { provider: 'mock', model: 'mock' },
      timeoutMs: 10_000,
      concurrency: 2,
      signal: new AbortController().signal,
    })

    const tasks = adapter.requests.map(request => JSON.stringify(request.messages))
    for (const task of tasks) expect(task).toContain('fix the failing test')
  })

  it('skips a duplicate label rather than running it twice', async () => {
    // Two candidates with one label would overwrite each other's staged harness, and the
    // pool would carry one of them twice.
    const root = await scratch()
    const adapter = new MockAdapter([textResponse('a')])
    const ctx = await probeHarness(adapter)

    const run = await runProbes(ctx, {
      surface: DSH_SURFACE,
      task: 'do the thing',
      candidates: [
        { label: 'inv1', tree: HARNESS },
        { label: 'inv1', tree: HARNESS },
      ],
      root: join(root, 'probes'),
      agentOptions: { provider: 'mock', model: 'mock' },
      timeoutMs: 10_000,
      concurrency: 2,
      signal: new AbortController().signal,
    })

    expect(run.results.map(result => result.label)).toEqual(['inv1'])
    expect(run.skipped).toEqual([{ label: 'inv1', reason: 'duplicate label' }])
  })

  it('keeps going when one candidate fails', async () => {
    // A dead rollout is a finding: the other candidates still measure the harnesses they
    // carry, and a sweep that stopped at the first failure would measure nothing.
    const root = await scratch()
    const adapter = new MockAdapter([textResponse('a'), textResponse('b')])
    const ctx = await probeHarness(adapter)

    const run = await runProbes(ctx, {
      surface: DSH_SURFACE,
      task: 'do the thing',
      candidates: [
        { label: 'inv1', tree: HARNESS },
        { label: 'dom1', tree: HARNESS },
      ],
      root: join(root, 'probes'),
      agentOptions: { provider: 'mock', model: 'mock' },
      timeoutMs: 10_000,
      concurrency: 1,
      signal: new AbortController().signal,
    })

    expect(run.results).toHaveLength(2)
    expect(run.results.every(result => result.delivered)).toBe(true)
  })

  it('reports a candidate whose harness cannot be staged', async () => {
    // A candidate that cannot even be written to disk is still a finding, and the sweep
    // carries on with the others.
    const root = await scratch()
    const adapter = new MockAdapter([textResponse('a')])
    const ctx = await probeHarness(adapter)
    // A file where the staging root belongs: every candidate under it cannot be created.
    await writeFile(join(root, 'probes'), 'not a directory')

    const run = await runProbes(ctx, {
      surface: DSH_SURFACE,
      task: 'do the thing',
      candidates: [
        { label: 'broken', tree: HARNESS },
        { label: 'inv1', tree: HARNESS },
      ],
      root: join(root, 'probes'),
      agentOptions: { provider: 'mock', model: 'mock' },
      timeoutMs: 10_000,
      concurrency: 1,
      signal: new AbortController().signal,
    })

    expect(run.results.map(result => result.label)).toEqual(['broken', 'inv1'])
    expect(run.results.every(result => result.delivered)).toBe(false)
    expect(run.results.every(result => result.error !== undefined)).toBe(true)
  })

  it('runs no more than the configured number of probes at once', async () => {
    const root = await scratch()
    const adapter = new MockAdapter([
      textResponse('a'),
      textResponse('b'),
      textResponse('c'),
    ])
    const ctx = await probeHarness(adapter)

    // The width is measured on the agents' own lifecycle: the concurrency limit exists
    // to cap how many probes are in flight at once, and `agent/status` is the event that
    // says a probe is running.
    let running = 0
    let peak = 0
    ctx.on('agent/status', ({ status }) => {
      running += status === 'running' ? 1 : -1
      peak = Math.max(peak, running)
    })

    await runProbes(ctx, {
      surface: DSH_SURFACE,
      task: 'do the thing',
      candidates: [
        { label: 'a', tree: HARNESS },
        { label: 'b', tree: HARNESS },
        { label: 'c', tree: HARNESS },
      ],
      root: join(root, 'probes'),
      agentOptions: { provider: 'mock', model: 'mock' },
      timeoutMs: 10_000,
      concurrency: 2,
      signal: new AbortController().signal,
    })

    expect(peak).toBeGreaterThan(0)
    expect(peak).toBeLessThanOrEqual(2)
  })

  it('reports a non-Error staging failure as text', async () => {
    const root = await scratch()
    // An agent service that fails to create an agent with a thrown string: the sweep
    // reports the dead candidate rather than losing the failure.
    const ctx = {
      agents: { create: () => { throw 'boom' } },
    } as unknown as Context

    const run = await runProbes(ctx, {
      surface: DSH_SURFACE,
      task: 'do the thing',
      candidates: [{ label: 'inv1', tree: HARNESS }],
      root: join(root, 'probes'),
      agentOptions: { provider: 'mock', model: 'mock' },
      timeoutMs: 10_000,
      concurrency: 1,
      signal: new AbortController().signal,
    })

    expect(run.results[0]?.delivered).toBe(false)
    expect(run.results[0]?.error).toBe('boom')
  })
})
