// ============================================================
//  Window factory — creates the BrowserWindow
// ============================================================
import { BrowserWindow, screen } from 'electron';
import path from 'node:path';

export function createMainWindow(opts?: { width?: number; height?: number }): BrowserWindow {
  const display = screen.getPrimaryDisplay();
  const width = opts?.width ?? Math.min(1440, display.workAreaSize.width - 100);
  const height = opts?.height ?? Math.min(900, display.workAreaSize.height - 100);

  const win = new BrowserWindow({
    width,
    height,
    minWidth: 960,
    minHeight: 600,
    title: 'Guang Code',
    backgroundColor: '#0b1220',
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      // NOTE: preload sandbox is disabled because sandboxed preloads run in
      // a restricted module-loader that does not allow `require('../foo')`.
      // We still get strong isolation via contextIsolation + no nodeIntegration.
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });

  // Open devtools only when explicitly asked (set GUANG_DEVTOOLS=1 before npm run ide)
  if (process.env.GUANG_DEVTOOLS === '1') {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  // Show once ready (avoids flash of unstyled content)
  win.once('ready-to-show', () => win.show());

  // Forward renderer console + errors to the main-process terminal so we can
  // debug a blank page from the outside.
  const tag = '[renderer]';
  win.webContents.on('console-message', (_e, level, message, line, source) => {
    const levels = ['debug', 'info', 'warn', 'error'];
    const lvl = levels[level] ?? 'log';
    process.stdout.write(`${tag} [${lvl}] ${source}:${line} — ${message}\n`);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    process.stderr.write(`${tag} render-process-gone: ${JSON.stringify(details)}\n`);
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    process.stderr.write(`${tag} did-fail-load ${code} ${desc} — ${url}\n`);
  });

  // Prevent renderer from navigating to arbitrary URLs
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => {
    // Allow same-origin loads; deny any external nav
    if (!url.startsWith('file://') && !url.startsWith('devtools://')) {
      e.preventDefault();
    }
  });

  return win;
}
