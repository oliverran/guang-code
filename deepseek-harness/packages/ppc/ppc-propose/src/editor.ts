/**
 * The editor session: a fresh agent that rewrites a staged harness copy in place.
 *
 * The session is deliberately narrow. It gets:
 *
 * - a fresh identity, so it inherits no part of the caller's conversation;
 * - a `cwd` of the staged harness directory, so every relative path it writes lands in the
 *   copy and nowhere else;
 * - a workspace-write file policy, so the editor can actually edit what it was pointed at;
 * - only the tools it needs to read, write and check the harness.
 *
 * What it does NOT get is the caller's evidence inlined into the prompt. The evidence is a
 * tree on disk, and the mission is a pointer to it, so nothing is truncated to fit a prompt
 * and the proposal can be as large as the evidence warrants.
 *
 * @module
 */

import { isAbsolute, join, relative, sep } from 'node:path'

import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-tools'

import { finalMessage, turnReason, withDeadline } from '@deepseek-ai/dsh-ppc-evidence'
import { readTree } from '@deepseek-ai/dsh-ppc-surface'
import type { Surface } from '@deepseek-ai/dsh-ppc-surface'

import { extractNotes, type Proposal } from './types.ts'

/**
 * The tools an editor session may call.
 *
 * The discovery tools are here for a concrete reason: an editor that can only `read` a
 * named path cannot find the evidence tree at all, because the tree's shape depends on
 * which rollouts ran. An editor that guesses filenames finds nothing, concludes it has no
 * evidence, and answers KEEP_BASE — a conclusion reached from a missing directory listing,
 * not from the evidence.
 */
export const EDITOR_TOOLS = ['read', 'write', 'edit', 'glob', 'grep', 'bash'] as const

/** How one editor session is configured. */
export interface EditorOptions {
  /** The surface the harness is written against. */
  readonly surface: Surface
  /** The staged harness directory the editor may write in. */
  readonly workspace: string
  /** The mission text: what to do and where the evidence is. */
  readonly mission: string
  /** The label this candidate carries. */
  readonly label: string
  /** The model route and id the editor runs on. */
  readonly agentOptions: { readonly provider?: string; readonly model?: string }
  /** How long the editor may run. */
  readonly timeoutMs: number
  /** A signal that cancels the session. */
  readonly signal: AbortSignal
}

/**
 * The reason a session's turn ended, or `none` when it closed no turn.
 * @param events - the editor session's events.
 * @returns the turn reason.
 */
export function editorTurnReason(events: readonly SessionEvent[]): string {
  return turnReason(events)
}

/**
 * The path a proposer sees for a directory, relative to the editor's working directory.
 *
 * The editor's `cwd` IS the staged harness, so the harness is `.` and the evidence tree is
 * whatever sits beside it. A mission that names an absolute path the editor cannot reach, or a
 * path relative to the wrong root, sends the proposer to look for evidence that is not there.
 * @param workspace - the editor's working directory.
 * @param target - the directory to name.
 * @returns the path as the editor will read it.
 */
export function workspacePath(workspace: string, target: string): string {
  const rel = relative(workspace, target)
  if (rel.length === 0) return '.'
  // A `..` prefix is still a relative path the editor can follow, so it stays relative; only a
  // path that leaves the shared root entirely is named absolutely.
  /* v8 ignore next -- path.relative is always relative on POSIX; it returns an absolute path only across differing Windows drives */
  if (isAbsolute(rel)) return target
  return rel.split(sep).join('/')
}

/**
 * Run one editor session and read back what it produced.
 *
 * The staged harness directory is the session's `cwd`, so a relative path the editor writes
 * lands there. The tree is read back from that directory afterwards, and only the files on
 * the editable surface count.
 *
 * @param ctx - the caller's context, which owns the agent lifecycle.
 * @param options - how this editor session runs.
 * @returns the proposal the session produced, including the harness tree it left behind.
 */
export async function runEditor(ctx: Context, options: EditorOptions): Promise<Proposal> {
  const sessionId = SessionId(`ppc-propose-${options.label}-${crypto.randomUUID()}`)
  const handle = await ctx.agents.create({
    sessionId,
    meta: { cwd: options.workspace, origin: 'subagent' },
    agentOptions: options.agentOptions,
    signal: options.signal,
    setup: (agentCtx) => {
      // The editor reads and writes the harness; it does not spawn agents, browse the web, or
      // touch anything else the deployment may have mounted.
      const restrictable = agentCtx.tools.get('read', agentCtx) !== undefined
        ? EDITOR_TOOLS.filter(name => agentCtx.tools.get(name, agentCtx) !== undefined)
        : []
      if (restrictable.length > 0) agentCtx.tools.restrict({ allow: restrictable })
    },
  })
  try {
    // The deployment's default file policy is `read-only`, so the editor could not write the
    // harness it was pointed at. `workspace-write` confines every write to the session's own
    // working directory — the staged harness — plus the platform temp areas, so the editor can
    // do its job without reaching anything else the deployment mounted.
    setSandboxMode(handle.agent.session, 'workspace-write')
    handle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: options.mission }],
      source: { kind: 'user' },
    }))
    await withDeadline(handle.agent.whenIdle(), options.timeoutMs, options.signal, 'editor session')
    const events = handle.agent.session.events
    const reply = finalMessage(events)
    const { tree, rejected } = await readTree(options.surface, options.workspace)
    const reason = editorTurnReason(events)
    if (reason !== 'completed') {
      return {
        label: options.label,
        ok: false,
        notes: extractNotes(reply),
        tree,
        rejected,
        error: `the editor session ended as ${reason}`,
      }
    }
    return { label: options.label, ok: true, notes: extractNotes(reply), tree, rejected }
  } finally {
    await handle.dispose()
  }
}

/**
 * The directory a candidate's staged harness lives in.
 * @param root - the working directory that holds the candidates.
 * @param label - the candidate's label.
 * @returns the staged harness directory.
 */
export function stagedHarnessDir(root: string, label: string): string {
  return join(root, label, 'harness')
}
