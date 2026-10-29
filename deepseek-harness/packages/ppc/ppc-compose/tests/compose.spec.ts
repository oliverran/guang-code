import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { describe, expect, it } from 'vitest'

import { compose } from '../src/index.ts'

async function scratch(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'dsh-ppc-compose-'))
}

async function composeHarness(adapter: MockAdapter): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

const CANDIDATES = [
  { label: 'base', produced: 'the base answer', delivered: true },
  { label: 'inv1', produced: 'the inv1 answer', delivered: true },
]

async function run(adapter: MockAdapter, overrides: Partial<Parameters<typeof compose>[1]> = {}) {
  const ctx = await composeHarness(adapter)
  const result = await compose(ctx, {
    root: join(await scratch(), 'pool'),
    task: 'do the thing',
    candidates: CANDIDATES,
    baseLabel: 'base',
    seed: 'seed',
    agentOptions: { provider: 'mock', model: 'mock' },
    timeoutMs: 10_000,
    signal: new AbortController().signal,
    ...overrides,
  })
  return result
}

describe('compose', () => {
  it('delivers the candidate the selector chose', async () => {
    const adapter = new MockAdapter([textResponse('<why>it was complete</why>\n```choice\nB\n```')])
    const result = await run(adapter)

    expect(result.fallback).toBe(false)
    expect(result.chosen?.id).toBe('B')
    expect(result.why).toBe('it was complete')
  })

  it('does not tell the selector which candidate came from which harness', async () => {
    const adapter = new MockAdapter([textResponse('```choice\nA\n```')])
    const result = await run(adapter)

    // The mission is what the selector read; a label or a diff in it would void the
    // anonymity the whole stage rests on.
    const mission = result.selector?.output ?? ''
    expect(mission).not.toContain('base')
    expect(result.pool.layout).not.toContain('base')
    expect(result.pool.layout).not.toContain('inv1')
  })

  it('falls back to the base when the selector names an id the pool never issued', async () => {
    const adapter = new MockAdapter([textResponse('```choice\nZ\n```')])
    const result = await run(adapter)

    expect(result.fallback).toBe(true)
    expect(result.chosen?.label).toBe('base')
    expect(result.error).toContain('Z')
  })

  it('falls back to the base when the selector answers with no choice at all', async () => {
    const adapter = new MockAdapter([textResponse('I like the second one.')])
    const result = await run(adapter)

    expect(result.fallback).toBe(true)
    expect(result.chosen?.label).toBe('base')
  })

  it('falls back to the base when the selector session fails', async () => {
    const adapter = new MockAdapter(['hang'])
    const result = await run(adapter, { timeoutMs: 50 })

    expect(result.fallback).toBe(true)
    expect(result.chosen?.label).toBe('base')
  })

  it('delivers nothing but says so when no candidate produced an answer', async () => {
    const adapter = new MockAdapter([textResponse('```choice\nA\n```')])
    const result = await run(adapter, {
      candidates: [{ label: 'dead', produced: '', delivered: false }],
    })

    expect(result.chosen).toBeUndefined()
    expect(result.fallback).toBe(true)
    expect(result.error).toContain('no candidate produced an answer')
    expect(adapter.requests).toHaveLength(0)
  })

  it('falls back to the first candidate when the pool holds no base', async () => {
    const adapter = new MockAdapter([textResponse('nothing')])
    const result = await run(adapter, {
      candidates: [
        { label: 'inv1', produced: 'the inv1 answer', delivered: true },
        { label: 'dom1', produced: 'the dom1 answer', delivered: true },
      ],
    })

    expect(result.fallback).toBe(true)
    expect(result.chosen).toBeDefined()
  })

  it('records the candidates that never reached the pool', async () => {
    const adapter = new MockAdapter([textResponse('```choice\nA\n```')])
    const result = await run(adapter, {
      candidates: [
        ...CANDIDATES,
        { label: 'dead', produced: '', delivered: false },
      ],
    })

    expect(result.pool.dropped).toEqual([{ label: 'dead', reason: 'the run did not deliver a completed turn' }])
  })

  it('passes the caller\'s source material into the pool', async () => {
    const adapter = new MockAdapter([textResponse('```choice\nA\n```')])
    const result = await run(adapter, { source: { 'data.csv': 'a,b\n1,2\n' } })

    // The source is what the work was done against, so the selector reads it beside the
    // candidates rather than being asked to judge the outputs against nothing.
    expect(await readFile(join(result.pool.root, 'source', 'data.csv'), 'utf8')).toBe('a,b\n1,2\n')
    expect(result.pool.layout).toContain('source/')
  })

  it('falls back to the first candidate when the caller names no base label', async () => {
    // Without a base label the fallback has no candidate to prefer, so the first pool
    // entry stands in: the stage still delivers an output somebody produced.
    const adapter = new MockAdapter([textResponse('I cannot decide.')])
    const ctx = await composeHarness(adapter)
    const result = await compose(ctx, {
      root: join(await scratch(), 'pool'),
      task: 'do the thing',
      candidates: CANDIDATES,
      seed: 'seed',
      agentOptions: { provider: 'mock', model: 'mock' },
      timeoutMs: 10_000,
      signal: new AbortController().signal,
    })

    expect(result.fallback).toBe(true)
    expect(result.chosen).toBeDefined()
  })
})
