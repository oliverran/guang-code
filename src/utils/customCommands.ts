import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import type { SlashCommand } from '../types/index.js'
import type { AppState } from '../types/index.js'

export const FRONTMATTER_REGEX = /^---\s*\n([\s\S]*?)---\s*\n?/

export type FrontmatterData = {
  description?: string
  'user-invocable'?: boolean
  [key: string]: unknown
}

export type ParsedMarkdown = {
  frontmatter: FrontmatterData
  content: string
}

export function parseFrontmatter(markdown: string): ParsedMarkdown {
  const match = markdown.match(FRONTMATTER_REGEX)

  if (!match) {
    return {
      frontmatter: {},
      content: markdown,
    }
  }

  const frontmatterText = match[1] || ''
  const content = markdown.slice(match[0].length)

  let frontmatter: FrontmatterData = {}
  try {
    const parsed = yaml.load(frontmatterText) as Record<string, unknown>
    if (parsed && typeof parsed === 'object') {
      frontmatter = parsed as FrontmatterData
    }
  } catch (err) {
    console.error('Failed to parse frontmatter:', err)
  }

  return { frontmatter, content }
}

export function loadCustomCommands(cwd: string): SlashCommand[] {
  const commandsDir = path.join(cwd, '.guang', 'commands')
  const commands: SlashCommand[] = []

  if (!fs.existsSync(commandsDir)) {
    return commands
  }

  try {
    const files = fs.readdirSync(commandsDir)
    
    for (const file of files) {
      if (!file.endsWith('.md')) continue
      
      const filePath = path.join(commandsDir, file)
      const stat = fs.statSync(filePath)
      
      if (!stat.isFile()) continue
      
      const fileContent = fs.readFileSync(filePath, 'utf-8')
      const { frontmatter, content } = parseFrontmatter(fileContent)
      
      const commandName = file.replace(/\.md$/, '')
      
      // Default to true if not explicitly set to false
      const userInvocable = frontmatter['user-invocable'] !== false
      
      if (!userInvocable) continue
      
      const description = frontmatter.description || `Custom command loaded from ${file}`
      
      commands.push({
        name: commandName,
        description,
        execute: async (args: string, state: AppState) => {
          // Simply return the markdown content as a system message to guide the AI
          // We prepend instructions so the AI knows it's a custom command template
          let finalContent = content
          
          if (args.trim()) {
            finalContent = `User provided arguments: ${args}\n\n${finalContent}`
          }
          
          return `[System: Executing custom command /${commandName}]\n\n${finalContent}`
        }
      })
    }
  } catch (err) {
    console.error(`Error loading custom commands from ${commandsDir}:`, err)
  }

  return commands
}
