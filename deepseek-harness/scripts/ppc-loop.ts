/**
 * The PPC loop, runnable and observable.
 *
 * One module owns the whole Propose–Probe–Compose round so that the two views of it — the
 * terminal demo and the HTTP dashboard — run the SAME code. A demo that re-implements the
 * loop is a demo of the demo, and the day the two drift, the acceptance evidence is
 * about something nobody ships.
 *
 * The loop reports through a callback rather than printing, so each view decides what its
 * own medium can show.
 *
 * @module scripts/ppc-loop
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { Context } from '@deepseek-ai/cordis'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import SandboxedFileSystem from '@deepseek-ai/dsh-fs-sandbox'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import * as ToolFsSearch from '@deepseek-ai/dsh-tool-fs-search'
import * as AgentInstructions from '@deepseek-ai/dsh-agent-instructions'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as ToolSkill from '@deepseek-ai/dsh-tool-skill'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import * as llmDeepseek from '@deepseek-ai/dsh-llm-deepseek'

import { DSH_SURFACE, proposeMission, readTree, writeTree } from '@deepseek-ai/dsh-ppc-surface'
import { buildEvidence, type RenderBudget } from '@deepseek-ai/dsh-ppc-evidence'
import { runEditor, stagedHarnessDir } from '@deepseek-ai/dsh-ppc-propose'
import { probeEvidence, runProbes } from '@deepseek-ai/dsh-ppc-probe'
import { compose } from '@deepseek-ai/dsh-ppc-compose'
import { Library, distilMission, renderExperience, runDistiller, type Experience } from '@deepseek-ai/dsh-ppc-library'

/** The task the loop runs against. */
export const DEMO_TASK = 'Write a one-paragraph summary of what a Propose–Probe–Compose loop does.'

/** The harness every candidate starts from. */
export const DEMO_BASE_HARNESS: Record<string, string> = {
  'PERSONA.md': 'You are a careful assistant. Answer the question directly and briefly.',
  'AGENTS.md': 'Answer the question. Be concise.',
}

/** The model route and id every stage runs on. */
export const DEMO_MODEL = { provider: 'deepseek-official', model: 'deepseek-v4-flash' } as const

/** The render budget the evidence tree is written with. */
const DEMO_BUDGET: RenderBudget = { obsTrunc: 4000, argsTrunc: 1000, maxChars: 60_000 }

/** Which stage an observation came from. */
type LoopStage = 'run' | 'probe-base' | 'propose' | 'probe' | 'compose' | 'library'

/** One observation the loop makes. */
export interface LoopEvent {
  /** The stage the observation came from. */
  readonly stage: LoopStage
  /** The candidate the observation is about, when it is about one. */
  readonly label?: string
  /** The headline: what happened. */
  readonly title: string
  /** The detail: the text itself. */
  readonly body: string
}

/** What the loop decided. */
export interface LoopOutcome {
  /** The chosen candidate's label. */
  readonly chosen?: string
  /** The chosen candidate's anonymous id. */
  readonly chosenId?: string
  /** The selector's reasoning. */
  readonly why: string
  /** The delivered output. */
  readonly delivered: string
  /** Whether the delivered output came from the fallback rather than the selector. */
  readonly fallback: boolean
}

/** How the loop is configured. */
export interface LoopOptions {
  /** The task the loop runs against. */
  readonly task: string
  /** The harness every candidate starts from. */
  readonly baseHarness: Record<string, string>
  /** The model route and id every stage runs on. */
  readonly model: { readonly provider: string; readonly model: string }
  /** How long one model call's stage may run. */
  readonly timeoutMs: number
  /** The task id the round's learning is stored under. */
  readonly taskId: string
  /** The domain the round's learning belongs to. */
  readonly domain: string
  /** The directory the library's domains live under. */
  readonly libraryRoot: string
  /** The lesson the round contributes, when it has one that qualifies. */
  readonly experience?: Partial<Experience>
  /** Called once per observation, as the loop makes it. */
  readonly onEvent: (event: LoopEvent) => void
}

/**
 * Mount the services the PPC stages need: the agent spine, the filesystem tools, and the
 * real DeepSeek adapter.
 * @returns the mounted context.
 */
async function mount(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(Timer)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SandboxPolicyService, { mode: 'read-only' })
  await ctx.plugin(SandboxedFileSystem, { cwd: process.cwd() })
  await ctx.plugin(ToolFs, {})
  await ctx.plugin(ToolFsSearch, {})
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SkillRegistry, {})
  await ctx.plugin(SkillFileSystem, {})
  await ctx.plugin(ToolSkill, {})
  await ctx.plugin(AgentInstructions, { maxBytes: 65_536 })
  await ctx.plugin(LocalCredentialProvider, { watch: false })
  await ctx.plugin(llmDeepseek, {
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    reasoningEffort: 'off',
    thinking: 'disabled',
  })
  await ctx.plugin(AgentLoop, { agents: [] })
  return ctx
}

/**
 * Derive the round's lesson from the round's own record.
 *
 * The distiller reads the evidence tree — the base rollout, the candidates' harnesses and
 * diffs, and the candidate outputs — and writes at most one lesson. A distiller that
 * declines, or that writes a record missing a required field, produces NO lesson: the
 * round taught nothing that could be stored, and the library is better off empty of it
 * than holding a guess.
 * @param ctx - the mounted context, which owns the agent lifecycle.
 * @param options - the record's location, the round's facts, and the model route.
 * @returns the lesson, or undefined when the round supported none.
 */
async function distilLesson(ctx: Context, options: {
  readonly root: string
  readonly task: string
  readonly chosenLabel: string
  readonly why: string
  readonly layout: string
  readonly agentOptions: { readonly provider: string; readonly model: string }
  readonly timeoutMs: number
  readonly signal: AbortSignal
}): Promise<Partial<Experience> | undefined> {
  const result = await runDistiller(ctx, {
    root: options.root,
    mission: distilMission({
      task: options.task,
      chosenLabel: options.chosenLabel,
      why: options.why,
      layout: options.layout,
    }),
    agentOptions: options.agentOptions,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
  })
  return result.experience
}

/**
 * Run one whole Propose–Probe–Compose round.
 *
 * The stages are observed as they land, so a viewer sees the loop's order rather than a
 * summary of its result. A failure is reported as an observation too: a round that died
 * halfway is still evidence about where it died.
 * @param options - the task, the base harness, the model route, and the observer.
 * @returns what the loop decided.
 */
export async function runPpcLoop(options: LoopOptions): Promise<LoopOutcome> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ppc-loop-'))
  const signal = new AbortController().signal
  const report = (stage: LoopStage, title: string, body: string, label?: string): void => {
    options.onEvent({ stage, ...label === undefined ? {} : { label }, title, body })
  }
  try {
    const ctx = await mount()

    const baseDir = join(root, 'base', 'harness')
    await writeTree(DSH_SURFACE, options.baseHarness, baseDir)
    const base = await readTree(DSH_SURFACE, baseDir)
    const staged = Object.entries(base.tree)
      .map(([path, body]) => `### ${path}\n${body}`)
      .join('\n\n')
    report('run', 'Base harness staged', staged)

    const baseProbe = await runProbes(ctx, {
      surface: DSH_SURFACE,
      task: options.task,
      candidates: [{ label: 'base', tree: base.tree }],
      root: join(root, 'probes'),
      agentOptions: options.model,
      timeoutMs: options.timeoutMs,
      concurrency: 1,
      signal,
    })
    const baseResult = baseProbe.results[0]
    if (baseResult === undefined) throw new Error('the base probe produced no result')
    report('probe-base', 'Base rollout', baseResult.output, 'base')

    const baseEvidence = probeEvidence([baseResult], base.tree, DEMO_BUDGET)
    const evidence = await buildEvidence(join(root, 'evidence'), {
      taskId: 'demo',
      task: options.task,
      rollouts: baseEvidence.rollouts,
      harness: base.tree,
    })
    report('run', 'Evidence tree', `${evidence.root}\n\n${evidence.mission.layout}`)

    const proposals: { label: string; tree: Record<string, string> }[] = []
    for (const dimension of ['INV', 'DOM'] as const) {
      const label = dimension === 'INV' ? 'inv1' : 'dom1'
      const workspace = stagedHarnessDir(join(root, 'proposals'), label)
      await writeTree(DSH_SURFACE, base.tree, workspace)
      const mission = proposeMission('../../evidence/demo', '.', evidence.mission.layout)
      const proposal = await runEditor(ctx, {
        surface: DSH_SURFACE,
        workspace,
        mission: `${mission}\n\n# YOUR DIMENSION\n\n${dimension === 'INV' ? 'Improve HOW the agent works.' : 'Improve WHAT the agent knows.'}\n`,
        label,
        agentOptions: options.model,
        timeoutMs: options.timeoutMs,
        signal,
      })
      proposals.push({ label, tree: proposal.tree })
      const changed = Object.entries(proposal.tree)
        .filter(([path, body]) => (base.tree[path] ?? '') !== body)
        .map(([path, body]) => `### ${path}\n${body}`)
        .join('\n\n')
      report('propose', `Propose · ${label}`, [proposal.notes, changed].filter(Boolean).join('\n\n---\n\n'), label)
    }

    const probeRun = await runProbes(ctx, {
      surface: DSH_SURFACE,
      task: options.task,
      candidates: [{ label: 'base', tree: base.tree }, ...proposals],
      root: join(root, 'probes'),
      agentOptions: options.model,
      timeoutMs: options.timeoutMs,
      concurrency: 2,
      signal,
    })
    for (const result of probeRun.results) {
      report('probe', `Probe · ${result.label}`, result.output, result.label)
    }

    const composed = await compose(ctx, {
      root: join(root, 'selection'),
      task: options.task,
      candidates: probeRun.results.map(result => ({
        label: result.label,
        produced: result.output,
        delivered: result.delivered,
      })),
      baseLabel: 'base',
      seed: 'demo-seed',
      agentOptions: options.model,
      timeoutMs: options.timeoutMs,
      signal,
    })
    const summary = [
      `pool ids: ${composed.pool.ids.join(', ')}`,
      `fallback: ${String(composed.fallback)}${composed.error === undefined ? '' : ` — ${composed.error}`}`,
      composed.why,
    ].filter(Boolean).join('\n\n')
    report('compose', `Compose · chosen ${composed.chosen?.label ?? '(none)'}`, summary)

    // The library is where the round's learning survives: the adopted harness and the
    // lesson it taught are stored, so a later task in this domain can read them.
    const library = new Library({
      root: options.libraryRoot,
      domain: options.domain,
      surface: DSH_SURFACE,
    })
    const adopted = composed.chosen === undefined
      ? undefined
      : proposals.find(proposal => proposal.label === composed.chosen?.label)?.tree ?? base.tree
    const lesson = options.experience ?? (await distilLesson(ctx, {
      root: join(root, 'evidence', 'demo'),
      task: options.task,
      chosenLabel: composed.chosen?.label ?? 'base',
      why: composed.why,
      layout: evidence.mission.layout,
      agentOptions: options.model,
      timeoutMs: options.timeoutMs,
      signal,
    }))
    const stored = await library.add(options.taskId, adopted ?? base.tree, {
      why: composed.why,
      label: composed.chosen?.label ?? 'base',
      experience: lesson,
    })
    report('library', 'Library · entry stored', stored && 'rejected' in stored
      ? `the lesson did not qualify: ${stored.rejected}`
      : `${options.taskId} → ${library.index}\n\n${renderExperience(stored.entry.experience ?? lesson as Experience)}`)

    await ctx.fiber.dispose()
    return {
      ...composed.chosen === undefined ? {} : { chosen: composed.chosen.label, chosenId: composed.chosen.id },
      why: composed.why,
      delivered: composed.chosen?.produced ?? '',
      fallback: composed.fallback,
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
