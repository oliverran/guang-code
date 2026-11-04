// ============================================================
//  Guang Code — Lightweight Web UI launcher (no Ink/Terminal deps)
//  Usage:
//    node scripts/start-ui.mjs
//    node scripts/start-ui.mjs --port=5173
//    node scripts/start-ui.mjs --host=0.0.0.0 --port=8080 --public
//    node scripts/start-ui.mjs --no-open   (skip browser auto-open)
//    node scripts/start-ui.mjs --cwd "/path/to/my project" --no-open
//    node scripts/start-ui.mjs --help
// ============================================================
import { spawn } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs as parseNodeArgs } from 'node:util';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const hostOs = process.platform;

export function parseArgs(argv) {
  const { values, tokens } = parseNodeArgs({
    args: argv,
    strict: true,
    allowPositionals: false,
    tokens: true,
    options: {
      cwd: { type: 'string' },
      port: { type: 'string', default: '5173' },
      host: { type: 'string' },
      public: { type: 'boolean', default: false },
      'no-open': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (!/^\d+$/.test(values.port) || Number(values.port) > 65535) {
    throw new Error('--port must be an integer between 0 and 65535 (0 selects a free port).');
  }
  if (values.cwd !== undefined && !values.cwd) throw new Error('--cwd requires a directory path.');
  if (values.host !== undefined && !values.host.trim()) throw new Error('--host requires a hostname or IP address.');
  let host = '127.0.0.1';
  for (const token of tokens) {
    if (token.name === 'public') host = '0.0.0.0';
    if (token.name === 'host') host = token.value;
  }
  return {
    cwd: values.cwd === undefined ? projectRoot : path.resolve(values.cwd),
    port: Number(values.port), host, public: values.public,
    open: !values['no-open'], help: values.help,
  };
}

const HELP = `Usage: npm run ui -- [options]

Options:
  --cwd <path>    Project directory (default: the guang-code repository)
  --port <port>   Port 0-65535 (default: 5173; 0 selects a free port)
  --host <host>   Bind address (default: 127.0.0.1)
  --public       Bind to 0.0.0.0; no authentication is provided
  --no-open      Do not open a browser automatically
  -h, --help     Show this help without starting a server

Values also accept --name=value. Quote paths containing spaces.
Relative --cwd paths are resolved from the launcher's working directory.
Keep this unauthenticated service local; do not expose it to the internet.
`;

function openBrowser(url) {
  try {
    if (hostOs === 'win32')        spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' });
    else if (hostOs === 'darwin')  spawn('open', [url], { detached: true, stdio: 'ignore' });
    else                           spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    return true;
  } catch { return false; }
}

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.help) {
    process.stdout.write(HELP);
    return;
  }
  let project;
  try { project = await stat(opts.cwd); }
  catch (err) {
    throw new Error(`Cannot access project directory "${opts.cwd}": ${err.code || err.message}`);
  }
  if (!project.isDirectory()) throw new Error(`Project path is not a directory: "${opts.cwd}"`);

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

  const webServerModule = pathToFileURL(path.join(projectRoot, 'dist', 'utils', 'webServer.js')).href;
  const { startWebServer } = await import(webServerModule);

  const banner = [
    '',
    '  ╔══════════════════════════════════════════════════════════╗',
    '  ║            Guang Code - Web UI Server                    ║',
    '  ╚══════════════════════════════════════════════════════════╝',
    '',
    `  Project : ${opts.cwd}`,
    `  Host    : ${opts.host}`,
    `  Port    : ${opts.port}`,
    `  Access  : no authentication; keep the service local`,
    '',
    '  Starting server...',
    '',
  ].join('\n');
  process.stdout.write(banner);

  try {
    const result = await startWebServer({ cwd: opts.cwd, port: opts.port, host: opts.host });
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
const entryPath = process.argv[1] ? await realpath(process.argv[1]).catch(() => null) : null;
if (entryPath === __filename) {
  main().catch(err => {
    process.stderr.write(`\n  ❌  ${err.message || err}\n  Use --help for available options.\n`);
    process.exitCode = 1;
  });
}
