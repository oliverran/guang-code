import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { MockAdapter, maxTokensResponse, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { describe, expect, it } from 'vitest'

import { DSH_SURFACE } from '@deepseek-ai/dsh-ppc-surface'

import { probeDir, runProbe } from '../src/index.ts'

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

describe('probeDir', () => {
  it('places each candidate in its own directory', () => {
    expect(probeDir('/work', 'inv1')).toBe(join('/work', 'inv1'))
  })
})

describe('runProbe', () => {
  it('runs the candidate and reports what it produced', async () => {
    const root = await scratch()
    const adapter = new MockAdapter([textResponse('the answer')])
    const ctx = await probeHarness(adapter)

    const result = await runProbe(ctx, {
      surface: DSH_SURFACE,
      tree: HARNESS,
      root: join(root, 'inv1'),
      task: 'do the thing',
      label: 'inv1',
      agentOptions: { provider: 'mock', model: 'mock' },
      timeoutMs: 10_000,
      signal: new AbortController().signal,
    })

    expect(result.label).toBe('inv1')
    expect(result.delivered).toBe(true)
    expect(result.turnReason).toBe('completed')
    expect(result.output).toBe('the answer')
    expect(result.error).toBeUndefined()
    expect(result.harness).toEqual(HARNESS)
  })

  it('gives the probe a fresh session that inherits nothing', async () => {
    // A probe that inherited the caller's conversation would be measured on the caller's
    // context as much as on its harness, and two candidates would differ in more than
    // their harness.
    const root = await scratch()
    const adapter = new MockAdapter([textResponse('done')])
    const ctx = await probeHarness(adapter)

    await runProbe(ctx, {
      surface: DSH_SURFACE,
      tree: HARNESS,
      root: join(root, 'inv1'),
      task: 'do the thing',
      label: 'inv1',
      agentOptions: { provider: 'mock', model: 'mock' },
      timeoutMs: 10_000,
      signal: new AbortController().signal,
    })

    expect(adapter.requests).toHaveLength(1)
    expect(adapter.requests[0]?.messages.length).toBe(1)
  })

  it('runs the session in the staged harness directory', async () => {
    // The instruction loader and the skill provider resolve against the session cwd, so the
    // staged directory IS the cwd: a probe that ran elsewhere would read another
    // `AGENTS.md` than the one it was given.
    const root = await scratch()
    const adapter = new MockAdapter([textResponse('done')])
    const ctx = await probeHarness(adapter)
    const staged = join(root, 'inv1')

    const result = await runProbe(ctx, {
      surface: DSH_SURFACE,
      tree: HARNESS,
      root: staged,
      task: 'do the thing',
      label: 'inv1',
      agentOptions: { provider: 'mock', model: 'mock' },
      timeoutMs: 10_000,
      signal: new AbortController().signal,
    })

    expect(result.workspace).toBe(staged)
  })

  it('registers the candidate persona as the deployment persona', async () => {
    // `PERSONA.md` is not read from disk at runtime: it becomes the deployment persona,
    // which is a prompt section. A probe that only staged the file would run the
    // deployment's identity and measure nothing.
    const root = await scratch()
    const adapter = new MockAdapter([textResponse('done')])
    const ctx = await probeHarness(adapter)

    await runProbe(ctx, {
      surface: DSH_SURFACE,
      tree: HARNESS,
      root: join(root, 'inv1'),
      task: 'do the thing',
      label: 'inv1',
      agentOptions: { provider: 'mock', model: 'mock' },
      timeoutMs: 10_000,
      signal: new AbortController().signal,
    })

    const system = adapter.requests[0]?.system ?? ''
    expect(system).toContain('You are the probe persona.')
    expect(system).not.toContain('You are a coding agent.')
  })

  it('reports a turn that did not complete', async () => {
    const root = await scratch()
    // A `max-tokens` finish ends the turn as `max-tokens`, not `completed`.
    const adapter = new MockAdapter([maxTokensResponse('partial')])
    const ctx = await probeHarness(adapter)

    const result = await runProbe(ctx, {
      surface: DSH_SURFACE,
      tree: HARNESS,
      root: join(root, 'inv1'),
      task: 'do the thing',
      label: 'inv1',
      agentOptions: { provider: 'mock', model: 'mock' },
      timeoutMs: 10_000,
      signal: new AbortController().signal,
    })

    expect(result.delivered).toBe(false)
    expect(result.turnReason).toBe('max-tokens')
  })

  it('reports a probe that ran out of time instead of throwing', async () => {
    const root = await scratch()
    const adapter = new MockAdapter(['hang'])
    const ctx = await probeHarness(adapter)

    const result = await runProbe(ctx, {
      surface: DSH_SURFACE,
      tree: HARNESS,
      root: join(root, 'inv1'),
      task: 'do the thing',
      label: 'inv1',
      agentOptions: { provider: 'mock', model: 'mock' },
      timeoutMs: 50,
      signal: new AbortController().signal,
    })

    expect(result.delivered).toBe(false)
    expect(result.error).toMatch(/exceeded 50ms/)
  })

  it('leaves no live agent behind', async () => {
    const root = await scratch()
    const adapter = new MockAdapter([textResponse('done')])
    const ctx = await probeHarness(adapter)

    await runProbe(ctx, {
      surface: DSH_SURFACE,
      tree: HARNESS,
      root: join(root, 'inv1'),
      task: 'do the thing',
      label: 'inv1',
      agentOptions: { provider: 'mock', model: 'mock' },
      timeoutMs: 10_000,
      signal: new AbortController().signal,
    })

    expect(ctx.agents.list()).toHaveLength(0)
  })

  it('runs a harness that carries no persona', async () => {
    const root = await scratch()
    const adapter = new MockAdapter([textResponse('done')])
    const ctx = await probeHarness(adapter)

    const result = await runProbe(ctx, {
      surface: DSH_SURFACE,
      // No `PERSONA.md`: there is no deployment persona to register, so the run keeps the
      // deployment's own and the probe still completes.
      tree: { 'AGENTS.md': 'You are a coding agent.' },
      root: join(root, 'inv1'),
      task: 'do the thing',
      label: 'inv1',
      agentOptions: { provider: 'mock', model: 'mock' },
      timeoutMs: 10_000,
      signal: new AbortController().signal,
    })

    expect(result.delivered).toBe(true)
    expect(result.output).toBe('done')
  })

  it('reports a non-Error failure as text', async () => {
    const root = await scratch()
    // A stage that fails with a thrown string rather than an Error: the failure text is
    // read by a person, so a non-Error is still reported rather than lost.
    const ctx = {
      agents: {
        create: async () => ({
          agent: {
            followup: () => undefined,
            whenIdle: () => { throw 'boom' },
            session: { events: [] },
          },
          dispose: () => Promise.resolve(),
        }),
      },
    } as unknown as Context

    const result = await runProbe(ctx, {
      surface: DSH_SURFACE,
      tree: HARNESS,
      root: join(root, 'inv1'),
      task: 'do the thing',
      label: 'inv1',
      agentOptions: { provider: 'mock', model: 'mock' },
      timeoutMs: 10_000,
      signal: new AbortController().signal,
    })

    expect(result.error).toBe('boom')
  })
})
