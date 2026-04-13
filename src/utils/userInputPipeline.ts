import { findSlashCommand } from '../commands/slashCommands.js'
import type { SlashCommand } from '../types/index.js'

export type ClassifiedUserInput =
  | { kind: 'slash'; command: SlashCommand; args: string }
  | { kind: 'prompt'; content: string }

export function classifyUserInput(trimmed: string, cwd: string): ClassifiedUserInput {
  const slash = findSlashCommand(trimmed, cwd)
  if (slash) return { kind: 'slash', command: slash.command, args: slash.args.trim() }
  return { kind: 'prompt', content: trimmed }
}

