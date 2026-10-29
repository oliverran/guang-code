/**
 * The PPC acceptance demo: run the Propose–Probe–Compose loop end to end and print
 * what each stage produced.
 *
 * The demo drives the four stage libraries against the real DeepSeek provider:
 *
 *   1. PROBE    the base harness runs the task and its rollout becomes the evidence
 *   2. PROPOSE  an editor session rewrites a staged harness against that evidence
 *   3. PROBE    every candidate harness runs the same task
 *   4. COMPOSE  an anonymous selector picks one candidate output
 *   5. LIBRARY  the adopted harness and the lesson it taught are stored
 *
 * It is a repository demo script, not a product CLI feature: it exists so a person can
 * read the whole loop's output at once and see that each stage does what it claims. The
 * loop itself lives in `scripts/ppc-loop.ts`, which the HTTP dashboard runs too.
 *
 * Run: `pnpm run demo:ppc` (needs `DEEPSEEK_API_KEY`, or a key in `$DSH_HOME/.credentials.yaml`).
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  DEMO_BASE_HARNESS,
  DEMO_MODEL,
  DEMO_TASK,
  runPpcLoop,
} from './ppc-loop.ts'

/** One stage's section header in the printed report. */
function section(title: string): void {
  console.log(`\n${'─'.repeat(72)}\n${title}\n${'─'.repeat(72)}`)
}

/** The main demo. */
async function main(): Promise<void> {
  const libraryRoot = await mkdtemp(join(tmpdir(), 'dsh-ppc-library-'))
  try {
    console.log('PPC demo: propose → probe → compose → library, against the real DeepSeek provider.')
    const outcome = await runPpcLoop({
      task: DEMO_TASK,
      baseHarness: DEMO_BASE_HARNESS,
      model: DEMO_MODEL,
      timeoutMs: 180_000,
      taskId: 'demo-task',
      domain: 'demo',
      libraryRoot,
      onEvent: (event) => {
        section(`${event.title}${event.label === undefined ? '' : ` · ${event.label}`}`)
        console.log(event.body)
      },
    })
    section('DELIVERED')
    console.log(`chosen: ${outcome.chosen ?? '(none)'} (anonymous id ${outcome.chosenId ?? '-'})`)
    console.log(`fallback: ${String(outcome.fallback)}`)
    console.log(`why:\n${outcome.why || '(the selector gave no reasoning)'}`)
    console.log(`\n${outcome.delivered || '(nothing was delivered)'}`)
    section('LIBRARY')
    console.log(`root: ${libraryRoot}`)
  } finally {
    await rm(libraryRoot, { recursive: true, force: true })
  }
}

await main()
