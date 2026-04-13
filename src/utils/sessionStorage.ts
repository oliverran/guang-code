// ============================================================
//  Guang Code — Session Storage (persistence & restore)
// ============================================================

import { readFile, writeFile, mkdir, readdir } from 'fs/promises'
import { join, resolve } from 'path'
import { homedir } from 'os'
import type { SessionMessage } from '../types/index.js'

const SESSIONS_DIR = join(homedir(), '.guang-code', 'sessions')

export type SavedSession = {
  id: string
  title?: string
  createdAt: number
  updatedAt: number
  cwd: string
  model: string
  messages: SessionMessage[]
  inputTokens: number
  outputTokens: number
}

async function ensureDir(): Promise<void> {
  await mkdir(SESSIONS_DIR, { recursive: true })
}

export async function saveSession(session: SavedSession): Promise<void> {
  await ensureDir()
  const filePath = join(SESSIONS_DIR, `${session.id}.json`)
  await writeFile(filePath, JSON.stringify(session, null, 2), 'utf-8')
}

export async function loadSession(sessionId: string): Promise<SavedSession | null> {
  try {
    const filePath = join(SESSIONS_DIR, `${sessionId}.json`)
    const raw = await readFile(filePath, 'utf-8')
    return JSON.parse(raw) as SavedSession
  } catch {
    return null
  }
}

export async function listSessions(): Promise<SavedSession[]> {
  await ensureDir()
  try {
    const files = await readdir(SESSIONS_DIR)
    const sessions: SavedSession[] = []

    for (const file of files) {
      if (!file.endsWith('.json')) continue
      try {
        const raw = await readFile(join(SESSIONS_DIR, file), 'utf-8')
        const session = JSON.parse(raw) as SavedSession
        sessions.push(session)
      } catch {
        // skip corrupt files
      }
    }

    return sessions.sort((a, b) => b.updatedAt - a.updatedAt)
  } catch {
    return []
  }
}

export function getSessionsDir(): string {
  return SESSIONS_DIR
}
