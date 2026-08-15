// ============================================================
//  Guang Code — Web UI status checker + port killer helper
//  Usage:   node scripts/check-ui.mjs
// ============================================================
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
const execAsync = promisify(exec);
const TARGET_PORT = Number(process.env.GC_UI_PORT) || 5173;

async function netstatWin(port) {
  try {
    const { stdout } = await execAsync(`netstat -ano | findstr ":${port}"`);
    const lines = stdout.trim().split('\n').filter(Boolean);
    const out = [];
    for (const ln of lines) {
      const parts = ln.trim().split(/\s+/);
      if (parts.length < 5) continue;
      const local = parts[1];
      if (!local.endsWith(`:${port}`)) continue;
      const state = parts[3] ?? '';
      const pid = parts[4];
      if (state === 'LISTENING') out.push({ pid, state });
    }
    return out;
  } catch { return []; }
}
async function netstatUnix(port) {
  try {
    const { stdout } = await execAsync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -F pn 2>/dev/null || ss -tlnp 'sport = :${port}' 2>/dev/null`);
    const m = stdout.match(/p(\d+)/);
    return m ? [{ pid: m[1], state: 'LISTENING' }] : [];
  } catch { return []; }
}

function whichListening(port) {
  return process.platform === 'win32' ? netstatWin(port) : netstatUnix(port);
}

const list = await whichListening(TARGET_PORT);
if (list.length === 0) {
  process.stdout.write(`  ⛔  Web UI: NOT running (port ${TARGET_PORT} free)\n  Tip:  npm run ui\n`);
  process.exit(1);
} else {
  process.stdout.write(`  ✅  Web UI: RUNNING on port ${TARGET_PORT}\n`);
  for (const item of list) {
    process.stdout.write(`      - PID ${item.pid}  state=${item.state}\n`);
  }
  process.stdout.write(`\n  🌐  Open:  http://127.0.0.1:${TARGET_PORT}\n`);
  process.stdout.write(`  ❌  Stop:  node scripts/stop-ui.mjs   (or kill -TERM ${list[0].pid})\n`);
}
