import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { MockAdapter, maxTokensResponse, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { describe, expect, it } from 'vitest'

import { runSelector } from '../src/index.ts'

async function scratch(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'dsh-ppc-compose-'))
}

async function selectorHarness(adapter: MockAdapter): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

/** The harness with a read tool and a write tool mounted, so the restriction has something to cut. */
async function toolHarness(adapter: MockAdapter): Promise<Context> {
  const ctx = await selectorHarness(adapter)
  ctx.tools.register(defineTool({
    name: 'read',
    description: 'Read a file.',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value as string }],
    },
    execute: () => Promise.resolve('read'),
  }))
  ctx.tools.register(defineTool({
    name: 'write',
    description: 'Write a file.',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value as string }],
    },
    execute: () => Promise.resolve('wrote'),
  }))
  return ctx
}

const MISSION = 'choose one'

describe('runSelector', () => {
  it('reads the choice out of the selector\'s reply', async () => {
    const root = await scratch()
    const adapter = new MockAdapter([textResponse('<why>it was complete</why>\n```choice\nB\n```')])
    const ctx = await selectorHarness(adapter)

    const result = await runSelector(ctx, {
      root,
      mission: MISSION,
      ids: ['A', 'B'],
      agentOptions: { provider: 'mock', model: 'mock' },
      timeoutMs: 10_000,
      signal: new AbortController().signal,
    })

    expect(result.delivered).toBe(true)
    expect(result.choice?.id).toBe('B')
    expect(result.choice?.why).toBe('it was complete')
  })

  it('ignores a choice the pool never issued', async () => {
    const root = await scratch()
    const adapter = new MockAdapter([textResponse('```choice\nZ\n```')])
    const ctx = await selectorHarness(adapter)

    const result = await runSelector(ctx, {
      root,
      mission: MISSION,
      ids: ['A', 'B'],
      agentOptions: { provider: 'mock', model: 'mock' },
      timeoutMs: 10_000,
      signal: new AbortController().signal,
    })

    expect(result.choice).toBeUndefined()
  })

  it('gives the selector a fresh session that inherits nothing', async () => {
    const root = await scratch()
    const adapter = new MockAdapter([textResponse('```choice\nA\n```')])
    const ctx = await selectorHarness(adapter)

    await runSelector(ctx, {
      root,
      mission: MISSION,
      ids: ['A'],
      agentOptions: { provider: 'mock', model: 'mock' },
      timeoutMs: 10_000,
      signal: new AbortController().signal,
    })

    expect(adapter.requests).toHaveLength(1)
    expect(adapter.requests[0]?.messages.length).toBe(1)
  })

  it('runs the session in the pool directory', async () => {
    // The pool IS the selector's world: a cwd anywhere else lets it read paths that
    // reveal which candidate came from which harness.
    const root = await scratch()
    const adapter = new MockAdapter([textResponse('```choice\nA\n```')])
    const ctx = await selectorHarness(adapter)

    const cwds: (string | undefined)[] = []
    ctx.on('agent/created', ({ agent }) => {
      cwds.push(agent.session.header.cwd)
    })

    await runSelector(ctx, {
      root,
      mission: MISSION,
      ids: ['A'],
      agentOptions: { provider: 'mock', model: 'mock' },
      timeoutMs: 10_000,
      signal: new AbortController().signal,
    })

    expect(cwds).toEqual([root])
  })

  it('takes away the selector\'s write capability', async () => {
    // A selector that could write could also edit the candidate it prefers, and the
    // anonymity the choice rests on would be gone.
    const root = await scratch()
    const adapter = new MockAdapter([textResponse('```choice\nA\n```')])
    const ctx = await toolHarness(adapter)

    const names: string[] = []
    ctx.on('agent/created', ({ agent }) => {
      names.push(...ctx.tools.schemas(agent).map(schema => schema.name))
    })

    await runSelector(ctx, {
      root,
      mission: MISSION,
      ids: ['A'],
      agentOptions: { provider: 'mock', model: 'mock' },
      timeoutMs: 10_000,
      signal: new AbortController().signal,
    })

    expect(names).toContain('read')
    expect(names).not.toContain('write')
  })

  it('reports a turn that did not complete', async () => {
    const root = await scratch()
    const adapter = new MockAdapter([maxTokensResponse('partial')])
    const ctx = await selectorHarness(adapter)

    const result = await runSelector(ctx, {
      root,
      mission: MISSION,
      ids: ['A'],
      agentOptions: { provider: 'mock', model: 'mock' },
      timeoutMs: 10_000,
      signal: new AbortController().signal,
    })

    expect(result.delivered).toBe(false)
    expect(result.turnReason).toBe('max-tokens')
  })

  it('reports a selector that ran out of time instead of throwing', async () => {
    const root = await scratch()
    const adapter = new MockAdapter(['hang'])
    const ctx = await selectorHarness(adapter)

    const result = await runSelector(ctx, {
      root,
      mission: MISSION,
      ids: ['A'],
      agentOptions: { provider: 'mock', model: 'mock' },
      timeoutMs: 50,
      signal: new AbortController().signal,
    })

    expect(result.delivered).toBe(false)
    expect(result.error).toMatch(/exceeded 50ms/)
  })

  it('leaves no live agent behind', async () => {
    const root = await scratch()
    const adapter = new MockAdapter([textResponse('```choice\nA\n```')])
    const ctx = await selectorHarness(adapter)

    await runSelector(ctx, {
      root,
      mission: MISSION,
      ids: ['A'],
      agentOptions: { provider: 'mock', model: 'mock' },
      timeoutMs: 10_000,
      signal: new AbortController().signal,
    })

    expect(ctx.agents.list()).toHaveLength(0)
  })
})
