import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { describe, expect, it } from 'vitest'

import { runReader } from '../src/index.ts'

async function scratch(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'dsh-ppc-evidence-'))
}

async function readerHarness(adapter: MockAdapter): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

describe('runReader', () => {
  it('reads the directory it was pointed at', async () => {
    const root = await scratch()
    const adapter = new MockAdapter([textResponse('the answer')])
    const ctx = await readerHarness(adapter)

    const result = await runReader(ctx, {
      root,
      mission: 'read and answer',
      agentOptions: { provider: 'mock', model: 'mock' },
      timeoutMs: 10_000,
      signal: new AbortController().signal,
      label: 'test',
      subject: 'reader session',
    })

    expect(result.output).toBe('the answer')
    expect(result.delivered).toBe(true)
    expect(result.turnReason).toBe('completed')
  })

  it('runs the session in the directory it reads', async () => {
    const root = await scratch()
    const adapter = new MockAdapter([textResponse('the answer')])
    const ctx = await readerHarness(adapter)

    const cwds: (string | undefined)[] = []
    ctx.on('agent/created', ({ agent }) => {
      cwds.push(agent.session.header.cwd)
    })

    await runReader(ctx, {
      root,
      mission: 'read and answer',
      agentOptions: { provider: 'mock', model: 'mock' },
      timeoutMs: 10_000,
      signal: new AbortController().signal,
      label: 'test',
      subject: 'reader session',
    })

    expect(cwds).toEqual([root])
  })

  it('takes away the reader\'s write capability', async () => {
    const root = await scratch()
    const adapter = new MockAdapter([textResponse('the answer')])
    const ctx = await readerHarness(adapter)
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

    const names: string[] = []
    ctx.on('agent/created', ({ agent }) => {
      names.push(...ctx.tools.schemas(agent).map(schema => schema.name))
    })

    await runReader(ctx, {
      root,
      mission: 'read and answer',
      agentOptions: { provider: 'mock', model: 'mock' },
      timeoutMs: 10_000,
      signal: new AbortController().signal,
      label: 'test',
      subject: 'reader session',
    })

    expect(names).toContain('read')
    expect(names).not.toContain('write')
  })

  it('keeps its whole surface when the deployment mounts no read tool', async () => {
    // With nothing to read, the directory's files are the mission's own subject, and
    // removing every tool would leave the reader with no way to answer at all.
    const root = await scratch()
    const adapter = new MockAdapter([textResponse('the answer')])
    const ctx = await readerHarness(adapter)

    const names: string[] = []
    ctx.on('agent/created', ({ agent }) => {
      names.push(...ctx.tools.schemas(agent).map(schema => schema.name))
    })

    await runReader(ctx, {
      root,
      mission: 'read and answer',
      agentOptions: { provider: 'mock', model: 'mock' },
      timeoutMs: 10_000,
      signal: new AbortController().signal,
      label: 'test',
      subject: 'reader session',
    })

    expect(names).toEqual([])
  })

  it('reports a failure rather than throwing', async () => {
    const root = await scratch()
    const adapter = new MockAdapter(['hang'])
    const ctx = await readerHarness(adapter)

    const result = await runReader(ctx, {
      root,
      mission: 'read and answer',
      agentOptions: { provider: 'mock', model: 'mock' },
      timeoutMs: 50,
      signal: new AbortController().signal,
      label: 'test',
      subject: 'reader session',
    })

    expect(result.delivered).toBe(false)
    expect(result.error).toMatch(/exceeded 50ms/)
  })

  it('reports a non-Error failure as text', async () => {
    const root = await scratch()
    const adapter = new MockAdapter(['hang'])
    const ctx = await readerHarness(adapter)

    const result = await runReader(ctx, {
      root,
      mission: 'read and answer',
      agentOptions: { provider: 'mock', model: 'mock' },
      timeoutMs: 50,
      signal: new AbortController().signal,
      label: 'test',
      subject: 'reader session',
    })

    // The failure text is read by a person, so a thrown string is still reported.
    expect(typeof result.error).toBe('string')
  })

  it('leaves no live agent behind', async () => {
    const root = await scratch()
    const adapter = new MockAdapter([textResponse('the answer')])
    const ctx = await readerHarness(adapter)

    await runReader(ctx, {
      root,
      mission: 'read and answer',
      agentOptions: { provider: 'mock', model: 'mock' },
      timeoutMs: 10_000,
      signal: new AbortController().signal,
      label: 'test',
      subject: 'reader session',
    })

    expect(ctx.agents.list()).toHaveLength(0)
  })
})

describe('runReader failure reporting', () => {
  it('reports a thrown non-Error as its text', async () => {
    const handle = {
      agent: {
        followup: (): void => { throw 'a string failure' },
        session: { events: [] },
      },
      dispose: () => Promise.resolve(),
    }
    const ctx = { agents: { create: () => Promise.resolve(handle) } } as unknown as Context

    const result = await runReader(ctx, {
      root: '/tmp',
      mission: 'read and answer',
      agentOptions: {},
      timeoutMs: 1000,
      signal: new AbortController().signal,
      label: 'test',
      subject: 'reader session',
    })

    expect(result.error).toBe('a string failure')
  })
})
