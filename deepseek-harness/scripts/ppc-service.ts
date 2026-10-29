/**
 * The PPC acceptance service: an HTTP dashboard over the Propose–Probe–Compose loop.
 *
 * The service runs the loop against the real DeepSeek provider and streams each stage's
 * progress to a browser page, so a person can watch the stages land in order and read what
 * each one produced without reading a terminal log.
 *
 * It is a repository demo service, not a product CLI feature. The loop itself lives in
 * `scripts/ppc-loop.ts`, which the terminal demo runs too.
 *
 *   `pnpm run service:ppc`  →  http://127.0.0.1:3111
 *
 * The loop needs `DEEPSEEK_API_KEY` (or a key in `$DSH_HOME/.credentials.yaml`).
 */

import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import {
  DEMO_BASE_HARNESS,
  DEMO_MODEL,
  DEMO_TASK,
  runPpcLoop,
  type LoopEvent,
} from './ppc-loop.ts'

/** The port the dashboard listens on. */
const PORT = Number(process.env.PPC_SERVICE_PORT ?? 3111)

/** One event the dashboard shows. */
interface StageEvent extends LoopEvent {
  /** The moment the event happened, as an ISO timestamp. */
  readonly at: string
}

/** The service's whole visible state. */
interface ServiceState {
  /** Whether a run is in flight. */
  running: boolean
  /** The task the loop runs against. */
  readonly task: string
  /** The directory the library's domains live under. */
  readonly libraryRoot: string
  /** The events, oldest first. */
  events: StageEvent[]
  /** The chosen candidate's label, once the compose stage lands. */
  chosen?: string
  /** The chosen candidate's anonymous id. */
  chosenId?: string
  /** The selector's reasoning. */
  why?: string
  /** The delivered output. */
  delivered?: string
  /** Whether the delivered output came from the fallback rather than the selector. */
  fallback?: boolean
}

const state: ServiceState = {
  running: false,
  task: DEMO_TASK,
  libraryRoot: process.env.PPC_LIBRARY_ROOT ?? join(tmpdir(), 'dsh-ppc-library'),
  events: [],
}

/** Every connected dashboard, so a new one gets the whole history. */
const listeners = new Set<(event: StageEvent) => void>()

/**
 * Run one round and record what it produced.
 *
 * The state is reset first so a second run does not show the first run's events beside
 * its own; a viewer reading the page must never see two rounds' stages interleaved.
 */
async function runLoop(): Promise<void> {
  if (state.running) return
  state.running = true
  state.events = []
  state.chosen = undefined
  state.chosenId = undefined
  state.why = undefined
  state.delivered = undefined
  state.fallback = undefined

  try {
    const outcome = await runPpcLoop({
      task: DEMO_TASK,
      baseHarness: DEMO_BASE_HARNESS,
      model: DEMO_MODEL,
      timeoutMs: 180_000,
      taskId: 'demo-task',
      domain: 'demo',
      libraryRoot: state.libraryRoot,
      onEvent: (event) => {
        const staged: StageEvent = { ...event, at: new Date().toISOString() }
        state.events.push(staged)
        for (const listener of listeners) listener(staged)
      },
    })
    state.chosen = outcome.chosen
    state.chosenId = outcome.chosenId
    state.why = outcome.why
    state.delivered = outcome.delivered
    state.fallback = outcome.fallback
  } catch (error) {
    const failed: StageEvent = {
      stage: 'run',
      title: 'Run failed',
      body: error instanceof Error ? error.message : String(error),
      at: new Date().toISOString(),
    }
    state.events.push(failed)
    for (const listener of listeners) listener(failed)
  } finally {
    state.running = false
  }
}

/** The dashboard page. */
const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>PPC acceptance dashboard</title>
<style>
  :root { color-scheme: light dark; --edge: #8883; }
  body { margin: 0; padding: 24px; font: 14px/1.6 ui-sans-serif, system-ui, sans-serif; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .task { opacity: .7; margin-bottom: 16px; }
  .bar { display: flex; gap: 12px; align-items: center; margin-bottom: 20px; }
  button { font: inherit; padding: 6px 14px; border-radius: 6px; border: 1px solid var(--edge);
           background: transparent; color: inherit; cursor: pointer; }
  button:disabled { opacity: .5; cursor: default; }
  .stage { border: 1px solid var(--edge); border-radius: 8px; margin-bottom: 12px; overflow: hidden; }
  .stage > summary { cursor: pointer; padding: 10px 14px; font-weight: 600; }
  .stage > summary small { font-weight: 400; opacity: .6; margin-left: 8px; }
  .body { padding: 0 14px 14px; white-space: pre-wrap; font-family: ui-monospace, monospace; font-size: 12px; }
  .final { border: 2px solid #4a9; border-radius: 8px; padding: 14px; margin-bottom: 16px; }
  .final h2 { font-size: 15px; margin: 0 0 8px; }
</style>
</head>
<body>
<h1>PPC acceptance dashboard</h1>
<div class="task" id="task"></div>
<div class="bar">
  <button id="run">Run the loop</button>
  <span id="status"></span>
</div>
<div id="final"></div>
<div id="events"></div>
<script>
const events = []
const statusEl = document.getElementById('status')
const eventsEl = document.getElementById('events')
const finalEl = document.getElementById('final')
const runBtn = document.getElementById('run')

function esc(text) {
  return String(text).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
}

function renderEvent(event) {
  const card = document.createElement('details')
  card.className = 'stage'
  card.open = event.stage === 'compose'
  const summary = document.createElement('summary')
  const label = event.label ? ' · ' + event.label : ''
  summary.textContent = event.title + label
  const small = document.createElement('small')
  small.textContent = event.at.slice(11, 19)
  summary.appendChild(small)
  const body = document.createElement('div')
  body.className = 'body'
  body.textContent = event.body || '(empty)'
  card.append(summary, body)
  eventsEl.appendChild(card)
}

function renderFinal(state) {
  if (!state.chosen) { finalEl.innerHTML = ''; return }
  finalEl.innerHTML = '<div class="final"><h2>Delivered: ' + esc(state.chosen)
    + ' (anonymous id ' + esc(state.chosenId || '-') + ')'
    + (state.fallback ? ' — FALLBACK, the selector did not choose' : '')
    + '</h2><div class="body">' + esc(state.delivered || '') + '</div></div>'
}

async function refresh() {
  const response = await fetch('/api/state')
  const state = await response.json()
  document.getElementById('task').textContent = state.task
  statusEl.textContent = state.running ? 'running…' : (state.chosen ? 'done' : 'idle')
  runBtn.disabled = state.running
  if (state.events.length !== events.length) {
    for (const event of state.events.slice(events.length)) { events.push(event); renderEvent(event) }
    renderFinal(state)
  }
}

runBtn.onclick = async () => {
  await fetch('/api/run', { method: 'POST' })
  events.length = 0
  eventsEl.innerHTML = ''
  finalEl.innerHTML = ''
  refresh()
}

const source = new EventSource('/api/events')
source.onmessage = message => {
  const event = JSON.parse(message.data)
  events.push(event)
  renderEvent(event)
}
setInterval(refresh, 2000)
refresh()
</script>
</body>
</html>
`

/** The HTTP server: the page, the state, the event stream, and the run trigger. */
const server = createServer((request, response) => {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname
  if (path === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(PAGE)
    return
  }
  if (path === '/api/state') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(state))
    return
  }
  if (path === '/api/events') {
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    response.write(': connected\n\n')
    const listener = (event: StageEvent): void => {
      response.write(`data: ${JSON.stringify(event)}\n\n`)
    }
    listeners.add(listener)
    request.on('close', () => { listeners.delete(listener) })
    return
  }
  if (path === '/api/run' && request.method === 'POST') {
    response.writeHead(202, { 'content-type': 'application/json' })
    response.end('{"started":true}')
    void runLoop()
    return
  }
  response.writeHead(404, { 'content-type': 'application/json' })
  response.end('{"error":"not found"}')
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`PPC acceptance dashboard: http://127.0.0.1:${PORT}`)
  console.log('Press the "Run the loop" button, or POST /api/run.')
})
