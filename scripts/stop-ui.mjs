// ============================================================
//  Guang Code — Web UI stop helper (cross-platform port killer)
//  Usage:   node scripts/stop-ui.mjs           # kill port 5173
//           node scripts/stop-ui.mjs --port=8080
// ============================================================
import { exec } from 'node:child_process';
import { promisify, parseArgs } from 'node:util';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const execAsync = promisify(exec);

export function parseStopArgs(args) {
  const { values } = parseArgs({ args, strict: true, allowPositionals: false,
    options: { port: { type: 'string', default: '5173' }, help: { type: 'boolean', short: 'h' } } });
  if (!/^\d+$/.test(values.port) || Number(values.port) < 1 || Number(values.port) > 65535) {
    throw new Error('--port must be an integer between 1 and 65535.');
  }
  return { port: Number(values.port), help: Boolean(values.help) };
}

// netstat's substring filter also returns ports such as 51730 when asked for
// 5173. Inspect the local endpoint, not the remote endpoint or a partial match.
export function parseWindowsListeners(stdout, port) {
  const pids = new Set();
  for (const line of stdout.split(/\r?\n/)) {
    const [protocol, local, , state, pid] = line.trim().split(/\s+/);
    if (protocol !== 'TCP' || state !== 'LISTENING' || !/^[1-9]\d*$/.test(pid ?? '')) continue;
    const localPort = local?.match(/:(\d+)$/)?.[1];
    if (localPort !== undefined && Number(localPort) === port) pids.add(pid);
  }
  return [...pids];
}

async function killPortWin(p) {
  const { stdout } = await execAsync(`netstat -ano | findstr ":${p}"`);
  const list = parseWindowsListeners(stdout, p);
  const killed = [];
  for (const pid of list) {
    try { await execAsync(`taskkill /PID ${pid} /F`); killed.push(pid); }
    catch { /* already dead */ }
  }
  return killed;
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

export async function main(args = process.argv.slice(2)) {
  const { port, help } = parseStopArgs(args);
  if (help) {
    process.stdout.write(`Usage: npm run ui:stop -- [--port PORT] [--help]

Stop processes listening on the selected TCP port (default: 5173).
This does not verify that the listener is Guang Code. Prefer Ctrl+C in the
terminal that started the UI; check the port owner before using this helper.
`);
    return;
  }
  process.stdout.write(`  🛑  Stopping listeners on port ${port} ...\n`);
  const killed = process.platform === 'win32' ? await killPortWin(port) : await killPortUnix(port);
  if (killed.length === 0) {
    process.stdout.write(`  ℹ️   No listener was stopped on port ${port}.\n`);
  } else {
    process.stdout.write(`  Stop requested for process(es): ${killed.join(', ')}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { await main(); }
  catch (err) {
    process.stderr.write(`  ❌  Stop failed: ${err.message || err}\n`);
    process.exitCode = 1;
  }
}
