import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

/**
 * Common Git utilities for Guang Code
 */

export async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    await execAsync('git rev-parse --is-inside-work-tree', { cwd })
    return true
  } catch {
    return false
  }
}

export async function getGitStatus(cwd: string): Promise<string> {
  try {
    const { stdout } = await execAsync('git status --short', { cwd })
    return stdout.trim()
  } catch (err) {
    return `Error: ${(err as Error).message}`
  }
}

export async function getGitDiff(cwd: string): Promise<string> {
  try {
    const { stdout } = await execAsync('git diff HEAD', { cwd })
    return stdout.trim()
  } catch (err) {
    return `Error: ${(err as Error).message}`
  }
}

export async function getCurrentBranch(cwd: string): Promise<string> {
  try {
    const { stdout } = await execAsync('git branch --show-current', { cwd })
    return stdout.trim()
  } catch (err) {
    return `Error: ${(err as Error).message}`
  }
}
