import fs from 'fs'
import path from 'path'
import { homedir } from 'os'
import type { ParsedMarkdown } from './customCommands.js'
import { parseFrontmatter } from './customCommands.js'

export type Skill = {
  id: string
  name: string
  description: string
  prompt: string
  allowedTools?: string[]
  arguments?: string[]
  argumentHint?: string
  userInvocable: boolean
  sourcePath: string
}

function safeRead(filePath: string): string | null {
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile()) return null
    const raw = fs.readFileSync(filePath, 'utf-8')
    return raw.trim() ? raw : null
  } catch {
    return null
  }
}

function parseAllowedTools(v: unknown): string[] | undefined {
  if (Array.isArray(v)) return v.map(String).filter(Boolean)
  if (typeof v === 'string') {
    const parts = v.split(',').map(s => s.trim()).filter(Boolean)
    return parts.length ? parts : undefined
  }
  return undefined
}

function parseArguments(v: unknown): string[] | undefined {
  if (Array.isArray(v)) return v.map(String).filter(Boolean)
  if (typeof v === 'string') {
    const parts = v.split(',').map(s => s.trim()).filter(Boolean)
    return parts.length ? parts : undefined
  }
  return undefined
}

function parseSkillMarkdown(raw: string): ParsedMarkdown {
  return parseFrontmatter(raw)
}

function buildSkillFromFile(opts: { id: string; filePath: string }): Skill | null {
  const raw = safeRead(opts.filePath)
  if (!raw) return null

  const { frontmatter, content } = parseSkillMarkdown(raw)
  const userInvocable = frontmatter['user-invocable'] !== false
  if (!userInvocable) return null

  const name = (typeof frontmatter.name === 'string' && frontmatter.name.trim())
    ? frontmatter.name.trim()
    : opts.id

  const description =
    (typeof frontmatter.description === 'string' && frontmatter.description.trim())
      ? frontmatter.description.trim()
      : (() => {
          const first = content.trim().split('\n').find(Boolean) ?? ''
          return first.slice(0, 160) || `Skill loaded from ${path.basename(opts.filePath)}`
        })()

  const allowedTools = parseAllowedTools((frontmatter as any)['allowed-tools'])
  const argumentsList = parseArguments((frontmatter as any).arguments)
  const argumentHint = typeof (frontmatter as any)['argument-hint'] === 'string'
    ? String((frontmatter as any)['argument-hint']).trim()
    : undefined

  return {
    id: opts.id,
    name,
    description,
    prompt: content.trim(),
    allowedTools,
    arguments: argumentsList,
    argumentHint,
    userInvocable: true,
    sourcePath: opts.filePath,
  }
}

function loadSkillsFromDir(baseDir: string): Skill[] {
  try {
    if (!fs.existsSync(baseDir)) return []
    const stat = fs.statSync(baseDir)
    if (!stat.isDirectory()) return []
  } catch {
    return []
  }

  const out: Skill[] = []
  const entries = fs.readdirSync(baseDir)
  for (const entry of entries) {
    const skillDir = path.join(baseDir, entry)
    try {
      const st = fs.statSync(skillDir)
      if (!st.isDirectory()) continue
    } catch {
      continue
    }

    const filePath = path.join(skillDir, 'SKILL.md')
    const skill = buildSkillFromFile({ id: entry, filePath })
    if (skill) out.push(skill)
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

export function loadAllSkills(cwd: string): Skill[] {
  const userDir = path.join(homedir(), '.guang-code', 'skills')
  const projectDir = path.join(cwd, '.guang', 'skills')

  const userSkills = loadSkillsFromDir(userDir)
  const projectSkills = loadSkillsFromDir(projectDir)

  const byId = new Map<string, Skill>()
  for (const s of userSkills) byId.set(s.id, s)
  for (const s of projectSkills) byId.set(s.id, s)

  return Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id))
}

export function renderSkillInvocation(skill: Skill, args: string): string {
  const argText = args.trim() ? `\n\nUser provided arguments:\n${args.trim()}\n` : ''
  const toolsText = skill.allowedTools && skill.allowedTools.length
    ? `\n\nAllowed tools: ${skill.allowedTools.join(', ')}\n`
    : ''
  const hintText = skill.argumentHint ? `\n\nArgument hint: ${skill.argumentHint}\n` : ''
  return [
    `[System: Executing skill /skill ${skill.id}]`,
    toolsText.trim() ? toolsText.trim() : '',
    hintText.trim() ? hintText.trim() : '',
    argText.trim() ? argText.trim() : '',
    '',
    skill.prompt,
  ].filter(Boolean).join('\n')
}

