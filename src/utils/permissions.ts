import fs from 'fs'
import path from 'path'
import type { PermissionMode, PermissionRule } from '../types/index.js'

export type PermissionDecision = 'allow' | 'deny' | 'ask'

function normalizeForMatch(p: string): string {
  return p.replace(/\\/g, '/')
}

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  const re = '^' + escaped.replace(/\\\*/g, '.*').replace(/\\\?/g, '.') + '$'
  return new RegExp(re, 'i')
}

function matchPattern(pattern: string, value: string): boolean {
  try {
    return wildcardToRegExp(pattern).test(value)
  } catch {
    return false
  }
}

export function loadProjectPermissionRules(cwd: string): PermissionRule[] {
  const fp = path.join(cwd, '.guang', 'permissions.json')
  if (!fs.existsSync(fp)) return []
  try {
    const raw = fs.readFileSync(fp, 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(Boolean) as PermissionRule[]
  } catch {
    return []
  }
}

function toolInputPath(toolName: string, input: Record<string, unknown> | undefined, cwd: string): string | null {
  if (!input) return null
  const key = (toolName === 'Read' || toolName === 'Write' || toolName === 'Edit') ? 'file_path' : null
  if (!key) return null
  const p = input[key] as string | undefined
  if (!p) return null
  return normalizeForMatch(path.resolve(cwd, p))
}

function toolInputCommand(toolName: string, input: Record<string, unknown> | undefined): string | null {
  if (!input) return null
  if (toolName !== 'Bash') return null
  const c = input.command as string | undefined
  return c ? String(c) : null
}

function isPlanWriteLikeBash(command: string): boolean {
  return /\b(rm|mv|cp|mkdir|touch|tee|dd|sed\s+-i|powershell|pwsh)\b/.test(command) || />\s*[^|]/.test(command)
}

export function decidePermission(opts: {
  permissionMode: PermissionMode
  rules: PermissionRule[]
  toolName: string
  toolInput?: Record<string, unknown>
  cwd: string
}): PermissionDecision {
  const { permissionMode, rules, toolName, toolInput, cwd } = opts

  if (permissionMode === 'auto') return 'allow'

  if (permissionMode === 'plan') {
    if (toolName === 'Write' || toolName === 'Edit') return 'deny'
    if (toolName === 'Bash') {
      const cmd = toolInputCommand(toolName, toolInput)
      if (cmd && isPlanWriteLikeBash(cmd)) return 'deny'
    }
  }

  let decision: PermissionDecision = 'ask'

  const absPath = toolInputPath(toolName, toolInput, cwd)
  const cmd = toolInputCommand(toolName, toolInput)
  const toolLower = toolName.toLowerCase()

  for (const rule of rules) {
    if (!rule || !rule.effect) continue

    if (rule.tool) {
      const rTool = String(rule.tool).toLowerCase()
      if (!matchPattern(rTool, toolLower)) continue
    }

    if (rule.path) {
      if (!absPath) continue
      const patt = normalizeForMatch(String(rule.path))
      if (!matchPattern(patt, absPath) && !matchPattern(patt, normalizeForMatch(path.relative(cwd, absPath)))) {
        continue
      }
    }

    if (rule.command) {
      if (!cmd) continue
      if (!matchPattern(String(rule.command), cmd)) continue
    }

    if (rule.effect === 'allow') decision = 'allow'
    else if (rule.effect === 'deny') decision = 'deny'
    else decision = 'ask'
  }

  return decision
}

