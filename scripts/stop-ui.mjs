// ============================================================
//  Guang Code — Web UI stop helper (cross-platform port killer)
//  Usage:   node scripts/stop-ui.mjs           # kill port 5173
//           node scripts/stop-ui.mjs --port=8080
// ============================================================
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
const execAsync = promisify(exec);

let port = 5173;
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--port=(\d+)$/);
  if (m) port = Number(m[1]);
}

async function killPortWin(p) {
  const { stdout } = await execAsync(`netstat -ano | findstr ":${p}"`);
  const pids = new Set();
  for (const ln of stdout.trim().split('\n').filter(Boolean)) {
    const parts = ln.trim().split(/\s+/);
    if (parts.length < 5) continue;
    const state = parts[3] ?? '';
    if (state !== 'LISTENING') continue;
    pids.add(parts[4]);
  }
  if (pids.size === 0) return [];
  const list = Array.from(pids);
  for (const pid of list) {
    try { await execAsync(`taskkill /PID ${pid} /F`); }
    catch { /* already dead */ }
  }
  return list;
}

async function killPortUnix(p) {
  try {
    const { stdout } = await execAsync(`lsof -nP -iTCP:${p} -sTCP:LISTEN -t 2>/dev/null`);
    const pids = stdout.trim().split('\n').filter(Boolean);
    if (pids.length === 0) return [];
    for (const pid of pids) {
      try { await execAsync(`kill -TERM ${pid}`); } catch {}
    }
    return pids;
  } catch {
    try {
      const { stdout } = await execAsync(`fuser -k ${p}/tcp 2>&1`);
      return [stdout.trim()];
    } catch { return []; }
  }
}

process.stdout.write(`  🛑  Stopping Web UI on port ${port} ...\n`);
try {
  const killed = process.platform === 'win32' ? await killPortWin(port) : await killPortUnix(port);
  if (killed.length === 0) {
    process.stdout.write(`  ℹ️   Nothing was listening on port ${port}.\n`);
  } else {
    process.stdout.write(`  ✅  Killed process(es): ${killed.join(', ')}\n`);
    process.stdout.write(`  Port ${port} is now free.\n`);
  }
} catch (err) {
  process.stderr.write(`  ❌  Stop failed: ${err.message || err}\n`);
  process.exit(1);
}
