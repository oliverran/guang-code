import { randomUUID } from 'crypto'
import { mkdir, readFile, writeFile } from 'fs/promises'
import path from 'path'
import { assertSafeLocalPath, resolveRealPathWithinCwd } from './pathSafety.js'

export type Decision = {
  id: string
  createdAt: number
  updatedAt: number
  title: string
  summary: string
  rationale?: string
  alternatives?: string[]
  owner?: string
  due?: string
  links?: string[]
  source?: { sessionId?: string }
}

export type DecisionLedger = {
  version: 1
  updatedAt: number
  decisions: Decision[]
}

function pmDir(cwd: string): string {
  return path.join(cwd, '.guang', 'pm')
}

function ledgerPath(cwd: string): string {
  return path.join(pmDir(cwd), 'decisions.json')
}

export async function loadDecisionLedger(cwd: string): Promise<DecisionLedger> {
  try {
    const raw = await readFile(ledgerPath(cwd), 'utf-8')
    const parsed = JSON.parse(raw) as DecisionLedger
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.decisions)) {
      return { version: 1, updatedAt: 0, decisions: [] }
    }
    return parsed
  } catch {
    return { version: 1, updatedAt: 0, decisions: [] }
  }
}

async function saveDecisionLedger(cwd: string, ledger: DecisionLedger): Promise<void> {
  await mkdir(pmDir(cwd), { recursive: true })
  await writeFile(ledgerPath(cwd), JSON.stringify(ledger, null, 2), 'utf-8')
}

export async function addDecision(cwd: string, input: Omit<Decision, 'id' | 'createdAt' | 'updatedAt'>): Promise<Decision> {
  const now = Date.now()
  const ledger = await loadDecisionLedger(cwd)
  const d: Decision = {
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    title: input.title,
    summary: input.summary,
    rationale: input.rationale,
    alternatives: input.alternatives,
    owner: input.owner,
    due: input.due,
    links: input.links,
    source: input.source,
  }
  ledger.decisions.push(d)
  ledger.updatedAt = now
  await saveDecisionLedger(cwd, ledger)
  return d
}

export async function linkDecision(cwd: string, idPrefix: string, link: string): Promise<Decision | null> {
  const ledger = await loadDecisionLedger(cwd)
  const d = ledger.decisions.find(x => x.id.startsWith(idPrefix) || x.id.slice(0, 8) === idPrefix)
  if (!d) return null
  const links = new Set([...(d.links ?? []), link])
  d.links = Array.from(links.values())
  d.updatedAt = Date.now()
  ledger.updatedAt = d.updatedAt
  await saveDecisionLedger(cwd, ledger)
  return d
}

export function renderDecisionList(ledger: DecisionLedger, limit = 20): string {
  const items = ledger.decisions.slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit)
  if (items.length === 0) return 'No decisions recorded.'
  const lines = items.map((d, i) => {
    const owner = d.owner ? `  owner:${d.owner}` : ''
    const due = d.due ? `  due:${d.due}` : ''
    return `${i + 1}. ${d.id.slice(0, 8)}  ${d.title}${owner}${due}`
  })
  return `Decisions:\n${lines.join('\n')}`
}

export function renderDecisionForPrompt(ledger: DecisionLedger, maxChars = 20000): string {
  const items = ledger.decisions.slice().sort((a, b) => b.updatedAt - a.updatedAt)
  const out: string[] = []
  let used = 0
  for (const d of items) {
    const block = [
      `- id: ${d.id}`,
      `  title: ${d.title}`,
      `  summary: ${d.summary}`,
      d.rationale ? `  rationale: ${d.rationale}` : null,
      d.owner ? `  owner: ${d.owner}` : null,
      d.due ? `  due: ${d.due}` : null,
      d.links?.length ? `  links: ${d.links.join(', ')}` : null,
    ].filter(Boolean).join('\n') + '\n'
    if (used + block.length > maxChars) break
    out.push(block)
    used += block.length
  }
  return out.length ? out.join('\n') : '[No decisions]'
}

export async function exportDecisionLedgerMarkdown(cwd: string, outPath: string): Promise<string> {
  const abs = assertSafeLocalPath({ cwd, inputPath: outPath })
  await resolveRealPathWithinCwd({ cwd, absPath: abs })
  const ledger = await loadDecisionLedger(cwd)
  const items = ledger.decisions.slice().sort((a, b) => b.updatedAt - a.updatedAt)
  const lines: string[] = ['# Decision Ledger', '']
  for (const d of items) {
    lines.push(`## ${d.title}`)
    lines.push('')
    lines.push(`- id: ${d.id}`)
    if (d.owner) lines.push(`- owner: ${d.owner}`)
    if (d.due) lines.push(`- due: ${d.due}`)
    lines.push(`- updated: ${new Date(d.updatedAt).toISOString()}`)
    lines.push('')
    lines.push(d.summary)
    lines.push('')
    if (d.rationale) {
      lines.push('### Rationale')
      lines.push(d.rationale)
      lines.push('')
    }
    if (d.alternatives?.length) {
      lines.push('### Alternatives')
      for (const a of d.alternatives) lines.push(`- ${a}`)
      lines.push('')
    }
    if (d.links?.length) {
      lines.push('### Links')
      for (const l of d.links) lines.push(`- ${l}`)
      lines.push('')
    }
  }
  await mkdir(path.dirname(abs), { recursive: true })
  await writeFile(abs, lines.join('\n'), 'utf-8')
  return abs
}

