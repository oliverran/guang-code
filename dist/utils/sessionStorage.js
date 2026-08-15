// ============================================================
//  Guang Code — Session Storage (persistence & restore)
// ============================================================
import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
const SESSIONS_DIR = join(homedir(), '.guang-code', 'sessions');
async function ensureDir() {
    await mkdir(SESSIONS_DIR, { recursive: true });
}
export async function saveSession(session) {
    await ensureDir();
    const filePath = join(SESSIONS_DIR, `${session.id}.json`);
    await writeFile(filePath, JSON.stringify(session, null, 2), 'utf-8');
}
export async function loadSession(sessionId) {
    try {
        const filePath = join(SESSIONS_DIR, `${sessionId}.json`);
        const raw = await readFile(filePath, 'utf-8');
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
export async function listSessions() {
    await ensureDir();
    try {
        const files = await readdir(SESSIONS_DIR);
        const sessions = [];
        for (const file of files) {
            if (!file.endsWith('.json'))
                continue;
            try {
                const raw = await readFile(join(SESSIONS_DIR, file), 'utf-8');
                const session = JSON.parse(raw);
                sessions.push(session);
            }
            catch {
                // skip corrupt files
            }
        }
        return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    }
    catch {
        return [];
    }
}
export function getSessionsDir() {
    return SESSIONS_DIR;
}
