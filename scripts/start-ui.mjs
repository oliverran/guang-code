// ============================================================
//  Guang Code — Lightweight Web UI launcher (no Ink/Terminal deps)
//  Usage:
//    node scripts/start-ui.mjs
//    node scripts/start-ui.mjs --port=5173
//    node scripts/start-ui.mjs --host=0.0.0.0 --port=8080 --public
//    node scripts/start-ui.mjs --no-open   (skip browser auto-open)
// ============================================================
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const hostOs = process.platform;

function parseArgs(argv) {
  const out = { port: 5173, host: '127.0.0.1', public: false, open: true };
  for (const a of argv.slice(2)) {
    if (a === '--public') { out.public = true; out.host = '0.0.0.0'; continue; }
    if (a === '--no-open') { out.open = false; continue; }
    const m = a.match(/^--(port|host)=([^\s]+)$/);
    if (m) {
      if (m[1] === 'port') out.port = Number(m[2]) || 5173;
      else out.host = m[2];
    }
  }
  return out;
}

function openBrowser(url) {
  try {
    if (hostOs === 'win32')        spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' });
    else if (hostOs === 'darwin')  spawn('open', [url], { detached: true, stdio: 'ignore' });
    else                           spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    return true;
  } catch { return false; }
}

async function main() {
  // 进程级兜底：防止未捕获异常/未处理 Promise rejection 导致服务直接崩。
  // 打印错误后保持 event loop，让用户能再试 + 有机会查日志。
  process.on('uncaughtException', (err, origin) => {
    const mark = `\n  🔥  [UNCAUGHT EXCEPTION] ${origin || 'unknown origin'}`;
    const body = err && (err.stack || err.message || String(err));
    process.stderr.write(mark + '\n  ' + body.split('\n').join('\n  ') + '\n\n');
    // 除非是严重的系统级错误（ENOMEM / EVADNEED / etc.），否则不退出
    const code = err && err.code;
    const killCodes = new Set(['ENOMEM', 'EFAULT', 'ERR_WORKER_INIT_FAILED', 'ERR_INVALID_THIS']);
    if (killCodes.has(code)) process.exit(100);
  });
  process.on('unhandledRejection', (reason, promise) => {
    const body = reason && (reason.stack || reason.message || String(reason)) || String(reason);
    process.stderr.write(
      `\n  ⚡  [UNHANDLED REJECTION] promise=${String(promise)}\n` +
      '  ' + body.split('\n').join('\n  ') + '\n\n'
    );
  });
  process.on('SIGTERM', () => process.exit(0));
  process.on('SIGINT', () => process.exit(0));

  const opts = parseArgs(process.argv);
  const webServerModule = pathToFileURL(path.join(projectRoot, 'dist', 'utils', 'webServer.js')).href;
  const { startWebServer } = await import(webServerModule);

  const banner = [
    '',
    '  ╔══════════════════════════════════════════════════════════╗',
    '  ║            Guang Code - Web UI Server                    ║',
    '  ╚══════════════════════════════════════════════════════════╝',
    '',
    `  Project : ${projectRoot}`,
    `  Host    : ${opts.host}`,
    `  Port    : ${opts.port}`,
    opts.public ? `  Mode    : public (allow LAN connections)` : `  Mode    : local-only (127.0.0.1)`,
    '',
    '  Starting server...',
    '',
  ].join('\n');
  process.stdout.write(banner);

  try {
    const result = await startWebServer({ cwd: projectRoot, port: opts.port, host: opts.host });
    const url = result.url;
    process.stdout.write([
      `  ✅  ${result.existing ? 'Already running' : 'Started successfully'}`,
      `  🔗  URL      : ${url}`,
      `  📋  SDK      : ${url}/sdk/v1 (NDJSON POST)`,
      `  📡  SSE      : ${url}/sdk/v1/sse`,
      `  💬  Chat API : ${url}/api/ui/chat (SSE streaming)`,
      '',
    ].join('\n'));
    if (opts.open && !result.existing) {
      const ok = openBrowser(url);
      process.stdout.write(ok
        ? `  🌐  Browser opened automatically\n`
        : `  ⚠️   Auto-open unavailable — paste the URL into your browser\n`);
    } else if (result.existing && opts.open) {
      openBrowser(url);
    }
    process.stdout.write('\n  Press Ctrl+C to stop the server.\n\n');
    // Node 原生 http server 本身会 keep event loop，不用手动 setInterval
  } catch (err) {
    if (String(err.message || err).includes('EADDRINUSE')) {
      process.stderr.write(`\n  ❌  Port ${opts.port} is already in use.\n`);
      process.stderr.write(`      Tip: run  node scripts/stop-ui.mjs  first, or use --port=N\n`);
      process.exit(2);
    }
    process.stderr.write(`\n  ❌  Failed to start: ${err.message || err}\n`);
    process.exit(1);
  }
}
main();
