import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import SandboxedFileSystem from '@deepseek-ai/dsh-fs-sandbox'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import { MockAdapter, maxTokensResponse, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { describe, expect, it } from 'vitest'

import { DSH_SURFACE } from '@deepseek-ai/dsh-ppc-surface'

import { runEditor, stagedHarnessDir, workspacePath } from '../src/index.ts'

async function scratch(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'dsh-ppc-propose-'))
}

async function editorHarness(adapter: MockAdapter): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

/** The editor harness with the real filesystem tools and a confining backend mounted. */
async function writableEditorHarness(adapter: MockAdapter): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(SandboxPolicyService, { mode: 'read-only' })
  await ctx.plugin(SandboxedFileSystem, {})
  await ctx.plugin(ToolFs, {})
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

/**
 * The sandbox modes the sessions appended while `work` ran.
 *
 * The editor's session is disposed when it ends, so the mode is read from the
 * session log while the session is still live rather than after the fact.
 * @param ctx - the context whose agents are observed.
 * @param work - the operation to run under observation.
 * @returns every mode the sessions appended, in the order they appended them.
 */
async function captureSandboxModes(ctx: Context, work: () => Promise<void>): Promise<string[]> {
  const modes: string[] = []
  const dispose = ctx.on('session/event', (_session, event) => {
    if (event.type === 'sandbox/mode') modes.push(event.data.mode)
  })
  try {
    await work()
  } finally {
    dispose()
  }
  return modes
}

describe('extractNotes', () => {
  it('reads the notes block', async () => {
    const { extractNotes } = await import('../src/index.ts')
    expect(extractNotes('blah\n<notes>\nkept -> AGENTS.md -> the run wasted budget\n</notes>'))
      .toBe('kept -> AGENTS.md -> the run wasted budget')
  })

  it('returns the whole reply when there is no notes block', async () => {
    const { extractNotes } = await import('../src/index.ts')
    expect(extractNotes('KEEP_BASE')).toBe('KEEP_BASE')
  })
})

describe('isKeepBase', () => {
  it('recognises the keep-base answer', async () => {
    const { isKeepBase } = await import('../src/index.ts')
    expect(isKeepBase('nothing in the evidence argues for a change. KEEP_BASE')).toBe(true)
    expect(isKeepBase('I changed AGENTS.md')).toBe(false)
  })
})

describe('stagedHarnessDir', () => {
  it('places each candidate in its own directory', () => {
    expect(stagedHarnessDir('/work', 'inv1')).toBe(join('/work', 'inv1', 'harness'))
  })
})

describe('workspacePath', () => {
  it('names the editor\'s own directory as the current directory', () => {
    expect(workspacePath('/work/inv1/harness', '/work/inv1/harness')).toBe('.')
  })

  it('names a sibling directory relative to the editor', () => {
    // `evidence` sits beside `harness`, so from inside the harness it is one level up.
    expect(workspacePath('/work/inv1/harness', '/work/inv1/evidence')).toBe('../evidence')
  })

  it('names a child directory relative to the editor', () => {
    expect(workspacePath('/work/inv1/harness', '/work/inv1/harness/scripts')).toBe('scripts')
  })

  it('names a path outside the workspace relatively, because the editor can still read it', () => {
    // Reads are not confined to the workspace, so the evidence tree stays reachable even when
    // it sits well above the staged harness.
    expect(workspacePath('/work/inv1/harness', '/elsewhere')).toBe('../../../elsewhere')
  })
})

describe('runEditor', () => {
  it('reads back the tree the editor left on disk', async () => {
    const workspace = await scratch()
    await writeFile(join(workspace, 'AGENTS.md'), 'original rules')
    const adapter = new MockAdapter([textResponse('<notes>kept -> AGENTS.md</notes>')])
    const ctx = await editorHarness(adapter)

    const proposal = await runEditor(ctx, {
      surface: DSH_SURFACE,
      workspace,
      mission: 'improve the harness',
      label: 'inv1',
      agentOptions: { provider: 'mock', model: 'mock' },
      timeoutMs: 10_000,
      signal: new AbortController().signal,
    })

    expect(proposal.ok).toBe(true)
    expect(proposal.label).toBe('inv1')
    expect(proposal.notes).toBe('kept -> AGENTS.md')
    expect(proposal.tree['AGENTS.md']).toBe('original rules')
    expect(proposal.rejected).toEqual([])
  })

  it('gives the editor a fresh session that inherits nothing', async () => {
    const workspace = await scratch()
    const adapter = new MockAdapter([textResponse('done')])
    const ctx = await editorHarness(adapter)

    await runEditor(ctx, {
      surface: DSH_SURFACE,
      workspace,
      mission: 'improve the harness',
      label: 'inv1',
      agentOptions: { provider: 'mock', model: 'mock' },
      timeoutMs: 10_000,
      signal: new AbortController().signal,
    })

    // The mission is the only thing the editor was told; no parent history reaches it.
    expect(adapter.requests).toHaveLength(1)
    expect(adapter.requests[0]?.messages.length).toBe(1)
  })

  it('reports a session that did not complete', async () => {
    const workspace = await scratch()
    // A `max-tokens` finish ends the turn as `max-tokens`, not `completed`.
    const adapter = new MockAdapter([maxTokensResponse('partial')])
    const ctx = await editorHarness(adapter)

    const proposal = await runEditor(ctx, {
      surface: DSH_SURFACE,
      workspace,
      mission: 'improve the harness',
      label: 'inv1',
      agentOptions: { provider: 'mock', model: 'mock' },
      timeoutMs: 10_000,
      signal: new AbortController().signal,
    })

    expect(proposal.ok).toBe(false)
    expect(proposal.error).toMatch(/ended as max-tokens/)
  })

  it('reports a file the editor wrote that is off the surface', async () => {
    const workspace = await scratch()
    const adapter = new MockAdapter([textResponse('done')])
    const ctx = await editorHarness(adapter)
    await writeFile(join(workspace, 'stray.md'), 'not on the surface')

    const proposal = await runEditor(ctx, {
      surface: DSH_SURFACE,
      workspace,
      mission: 'improve the harness',
      label: 'inv1',
      agentOptions: { provider: 'mock', model: 'mock' },
      timeoutMs: 10_000,
      signal: new AbortController().signal,
    })

    expect(proposal.rejected).toEqual(['stray.md'])
    expect(proposal.tree['stray.md']).toBeUndefined()
  })

  it('keeps the staged harness readable after the session ends', async () => {
    const workspace = await scratch()
    await writeFile(join(workspace, 'AGENTS.md'), 'original rules')
    const adapter = new MockAdapter([textResponse('done')])
    const ctx = await editorHarness(adapter)

    await runEditor(ctx, {
      surface: DSH_SURFACE,
      workspace,
      mission: 'improve the harness',
      label: 'inv1',
      agentOptions: { provider: 'mock', model: 'mock' },
      timeoutMs: 10_000,
      signal: new AbortController().signal,
    })

    expect(await readFile(join(workspace, 'AGENTS.md'), 'utf8')).toBe('original rules')
  })

  it('gives the editor a session that can write inside its own workspace', async () => {
    // The deployment's default file policy is read-only. Without the editor's own
    // workspace-write mode, every write the editor attempts is denied and every
    // proposal comes back empty — a failure that looks like a model problem.
    const workspace = await scratch()
    const adapter = new MockAdapter([textResponse('done')])
    const ctx = await writableEditorHarness(adapter)
    const modes = await captureSandboxModes(ctx, async () => {
      await runEditor(ctx, {
        surface: DSH_SURFACE,
        workspace,
        mission: 'improve the harness',
        label: 'inv1',
        agentOptions: { provider: 'mock', model: 'mock' },
        timeoutMs: 10_000,
        signal: new AbortController().signal,
      })
    })

    expect(modes).toEqual(['workspace-write'])
    // The mode is confined to the editor's own session; the deployment default is untouched.
    expect(ctx.get('sandboxPolicy')?.defaultMode).toBe('read-only')
  })

  it('records the mode in the session log, so it is replayable and auditable', async () => {
    const workspace = await scratch()
    const adapter = new MockAdapter([textResponse('done')])
    const ctx = await writableEditorHarness(adapter)
    const modes = await captureSandboxModes(ctx, async () => {
      await runEditor(ctx, {
        surface: DSH_SURFACE,
        workspace,
        mission: 'improve the harness',
        label: 'inv1',
        agentOptions: { provider: 'mock', model: 'mock' },
        timeoutMs: 10_000,
        signal: new AbortController().signal,
      })
    })

    // The mode lives in the session log, not in out-of-band state.
    expect(modes).toContain('workspace-write')
  })
})
