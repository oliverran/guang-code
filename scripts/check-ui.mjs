// Inspect TCP listeners; an occupied port does not prove it belongs to Guang Code.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseStopArgs, parseWindowsListeners } from './stop-ui.mjs';
const execFileAsync = promisify(execFile);

export function parseLsofListeners(stdout) {
  return [...new Set(stdout.split(/\r?\n/).filter(line => /^p[1-9]\d*$/.test(line)))]
    .map(line => ({ pid: line.slice(1) }));
}

export function parseSsListeners(stdout, port) {
  const listeners = [];
  for (const line of stdout.split(/\r?\n/)) {
    const [state, , , local] = line.trim().split(/\s+/);
    if (state !== 'LISTEN' || Number(local?.match(/:(\d+)$/)?.[1]) !== port) continue;
    const pids = [...line.matchAll(/\bpid=([1-9]\d*)\b/g)].map(match => match[1]);
    // ss can report a listener without exposing another user's process details.
    for (const pid of new Set(pids.length ? pids : [null])) listeners.push({ pid });
  }
  return listeners;
}

export async function inspectListeners(port, platform = process.platform, run = execFileAsync) {
  if (platform === 'win32') {
    const { stdout } = await run('netstat', ['-ano'], { timeout: 5000 });
    return parseWindowsListeners(stdout, port).map(pid => ({ pid }));
  }
  let lsofEmpty = false;
  try {
    const { stdout } = await run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-F', 'pn'], { timeout: 5000 });
    const listeners = parseLsofListeners(stdout);
    if (listeners.length) return listeners;
    lsofEmpty = true;
  } catch (error) {
    // lsof uses exit 1 for no matches. Warnings/errors must not become "free".
    lsofEmpty = error.code === 1 && !String(error.stderr ?? '').trim() && !String(error.stdout ?? '').trim();
  }
  try {
    const { stdout } = await run('ss', ['-tlnp', `sport = :${port}`], { timeout: 5000 });
    return parseSsListeners(stdout, port);
  } catch {
    if (lsofEmpty) return [];
    throw new Error('Cannot inspect TCP listeners. Install lsof or ss and check permissions.');
  }
}

export async function main(args = process.argv.slice(2), env = process.env, inspect = inspectListeners) {
  const { port, help } = parseStopArgs([
    ...(env.GC_UI_PORT === undefined ? [] : [`--port=${env.GC_UI_PORT}`]), ...args,
  ]);
  if (help) {
    process.stdout.write('Usage: npm run ui:status -- [--port PORT] [--help]\nDefault port: GC_UI_PORT or 5173. Inspects listeners, not application identity.\n');
    return 0;
  }
  const listeners = await inspect(port);
  if (!listeners.length) {
    process.stdout.write(`No TCP listener detected on port ${port}.\nTip: npm run ui\n`);
    return 1;
  }
  process.stdout.write(`TCP port ${port}: LISTENING (application identity not verified).\n`);
  for (const { pid } of listeners) process.stdout.write(`  PID: ${pid ?? 'unavailable'}\n`);
  process.stdout.write(`Check: http://127.0.0.1:${port}\nPrefer Ctrl+C in the terminal that started the UI.\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = await main(); }
  catch (error) {
    process.stderr.write(`Status UNKNOWN: ${error.message || error}\n`);
    process.exitCode = 2;
  }
}
