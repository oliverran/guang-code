import fs from 'fs'
import path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export type HookEvent = 
  | 'SessionStart'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'SessionEnd'

export type HookConfig = {
  type: 'command'
  command: string
  matcher?: string
}

export type HooksSettings = Record<string, HookConfig[]>

export class HooksManager {
  private hooks: HooksSettings = {}

  async loadHooks(cwd: string): Promise<void> {
    const hooksPath = path.join(cwd, '.guang', 'hooks.json')
    if (!fs.existsSync(hooksPath)) {
      return
    }

    try {
      const content = fs.readFileSync(hooksPath, 'utf-8')
      this.hooks = JSON.parse(content) as HooksSettings
    } catch (err) {
      console.error('Failed to load hooks config:', err)
    }
  }

  async triggerEvent(event: HookEvent, cwd: string, context?: Record<string, unknown>): Promise<void> {
    const eventHooks = this.hooks[event]
    if (!eventHooks || !Array.isArray(eventHooks)) {
      return
    }

    for (const hook of eventHooks) {
      if (hook.type === 'command') {
        // If there's a matcher (e.g. for PreToolUse to match specific tools)
        if (hook.matcher && context && context.tool_name) {
          const matchers = hook.matcher.split(',').map(s => s.trim())
          if (!matchers.includes('*') && !matchers.includes(context.tool_name as string)) {
            continue
          }
        }

        try {
          const env = { 
            ...process.env, 
            GUANG_HOOK_CONTEXT: JSON.stringify(context || {}) 
          }
          await execAsync(hook.command, { cwd, env })
        } catch (err) {
          console.error(`Hook ${event} failed to execute command "${hook.command}":`, err)
        }
      }
    }
  }
}

export const hooksManager = new HooksManager()
