// ============================================================
//  Guang Code — Main Entry Point
// ============================================================

import React from 'react'
import { render } from 'ink'
import { Command } from 'commander'
import { randomUUID } from 'crypto'
import { resolve } from 'path'
import chalk from 'chalk'
import figures from 'figures'
import { App } from './components/App.js'
import type { AppState } from './types/index.js'
import { listSessions, loadSession } from './utils/sessionStorage.js'
import { loadConfig, CONFIG_PATH, migratePlaintextKeysIfNeeded } from './utils/config.js'

// ── CLI setup ────────────────────────────────────────────────
const program = new Command()

program
  .name('guang')
  .description('Guang Code — Terminal AI Coding Assistant')
  .version('1.0.0')
  .option('-k, --api-key <key>', 'API key override for current session (any provider)')
  .option('-m, --model <model>', 'AI model to use (overrides config default)')
  .option('--auto', 'Start in auto permission mode (no confirmations)')
  .option('--plan', 'Start in plan mode (read-only until approved)')
  .option('-r, --resume <sessionId>', 'Resume a previous session by ID')
  .option('--cwd <path>', 'Working directory (defaults to process.cwd())')
  .argument('[prompt]', 'Initial prompt to send immediately')

program.parse()

const opts = program.opts()
const [initialPrompt] = program.args

// ── Load config ───────────────────────────────────────────────
let config = await loadConfig()
config = await migratePlaintextKeysIfNeeded(config)

// ── Resolve model ─────────────────────────────────────────────
const model = (opts.model as string | undefined) ?? config.defaultModel

// ── Permission mode ───────────────────────────────────────────
const permissionMode = opts.auto
  ? ('auto' as const)
  : opts.plan
    ? ('plan' as const)
    : config.defaultMode

// ── Working directory ─────────────────────────────────────────
const cwd = opts.cwd ? resolve(opts.cwd as string) : process.cwd()

// ── Validate: at least one API key must exist for the chosen model ─
// (We do this lazily — the error surfaces when the first query runs)

// ── Initial app state ─────────────────────────────────────────
async function buildInitialState(): Promise<AppState> {
  const now = Date.now()
  const base: AppState = {
    messages: [],
    isLoading: false,
    permissionMode,
    model,
    providerConfig: config,
    inputTokens: 0,
    outputTokens: 0,
    cwd,
    sessionId: randomUUID(),
    sessionCreatedAt: now,
    pendingPermission: null,
    error: null,
    spinnerText: '',
    planApproved: false,
  }

  // Resume previous session
  if (opts.resume) {
    const raw = String(opts.resume)
    let targetId: string | null = raw
    if (!/^[0-9a-fA-F-]{32,}$/.test(raw) || raw.length < 32) {
      const sessions = await listSessions()
      if (/^\d+$/.test(raw)) {
        const idx = Number(raw)
        const s = Number.isFinite(idx) ? sessions[idx - 1] : undefined
        targetId = s?.id ?? null
      } else {
        const pref = raw.toLowerCase()
        const s = sessions.find(x => x.id.toLowerCase().startsWith(pref))
        targetId = s?.id ?? null
      }
    }

    const saved = targetId ? await loadSession(targetId) : null
    if (saved) {
      console.log(`  ${chalk.cyan(figures.arrowLeft)}  Resuming session ${chalk.bold(saved.id.slice(0, 8))} (${saved.messages.length} messages)`)
      return {
        ...base,
        sessionId: saved.id,
        sessionCreatedAt: saved.createdAt,
        sessionTitle: saved.title,
        messages: saved.messages,
        inputTokens: saved.inputTokens,
        outputTokens: saved.outputTokens,
        model: saved.model,
        cwd: saved.cwd,
      }
    } else {
      console.error(`  ${chalk.red(figures.cross)}  Session not found: ${opts.resume}`)
    }
  }

  if (initialPrompt) {
    base.messages.push({
      id: randomUUID(),
      role: 'user',
      content: initialPrompt,
      timestamp: Date.now(),
    })
  }

  return base
}

// ── Boot ──────────────────────────────────────────────────────
async function main() {
  process.on('uncaughtException', (err) => {
    if (
      err.message?.includes('write after end') ||
      err.message?.includes('Cannot read properties') ||
      err.message?.includes('Raw mode is not supported')
    ) return
    console.error(chalk.red(`${figures.cross} Unexpected error:`), err.message)
  })

  const initialState = await buildInitialState()

  const { unmount } = render(
    <App
      initialState={initialState}
      apiKeyOverride={opts.apiKey as string | undefined}
    />,
    { exitOnCtrlC: false },
  )

  process.on('SIGINT', () => { unmount(); process.exit(0) })
  process.on('SIGTERM', () => { unmount(); process.exit(0) })
}

main().catch(err => {
  console.error(chalk.red(`${figures.cross} Fatal error:`), err.message)
  process.exit(1)
})
