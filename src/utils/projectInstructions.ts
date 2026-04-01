import fs from 'fs'
import path from 'path'
import { loadAllInstructions } from './claudeMd.js'

/**
 * Searches for project instruction files in the given directory.
 * Looks for GUANG.md first, then falls back to CLAUDE.md.
 * 
 * @param cwd The directory to search in
 * @returns The content of the instruction file, or null if not found
 */
export function loadProjectInstructions(cwd: string): string | null {
  const loaded = loadAllInstructions(cwd)
  if (loaded?.text) return loaded.text

  const possibleFiles = ['GUANG.md', 'CLAUDE.md']
  for (const filename of possibleFiles) {
    const fullPath = path.join(cwd, filename)
    if (!fs.existsSync(fullPath)) continue
    try {
      const content = fs.readFileSync(fullPath, 'utf-8')
      return content.trim() ? content : null
    } catch {
      continue
    }
  }

  return null
}
