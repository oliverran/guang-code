// ============================================================
//  Guang Code IDE — Electron main entry
// ============================================================
import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { BackendManager } from './backend';
import { PtyManager } from './terminal';
import { registerIpc } from './ipc';
import { createMainWindow } from './window';

// Resolve project root: this file lives in  <repo>/ide/src/main/index.ts
// In dev, __dirname = <repo>/ide/src/main; we want <repo>.
// After tsc -> dist/main, __dirname = <repo>/ide/dist/main; we still want <repo>.
const projectRoot = path.resolve(__dirname, '..', '..', '..');

let mainWindow: BrowserWindow | null = null;
const backend = new BackendManager({ projectRoot });
const ptyMgr = new PtyManager();

const isDev = process.env.NODE_ENV === 'development' || !!process.env.GUANG_DEVTOOLS;

function getMainWindow() {
  return mainWindow;
}

async function bootstrap() {
  registerIpc({ backend, ptyMgr, getMainWindow });

  mainWindow = createMainWindow();

  if (isDev) {
    const devUrl = process.env.GUANG_VITE_URL ?? 'http://localhost:5173';
    await mainWindow.loadURL(devUrl);
  } else {
    await mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }

  mainWindow.on('closed', () => { mainWindow = null; });

  // Start backend lazily (after window is up so the user sees UI even if backend fails)
  try {
    await backend.start();
    console.log(`[Guang IDE] Backend ready at ${backend.status.url}`);
  } catch (err) {
    console.error('[Guang IDE] Backend failed to start:', err);
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow?.webContents.send('backend:status-changed', {
        ...backend.status,
        error: String(err),
      });
    });
  }
}

// App lifecycle ----------------------------------------------------------
app.whenReady().then(bootstrap).catch((err) => {
  console.error('[Guang IDE] bootstrap failed:', err);
  app.exit(1);
});

app.on('window-all-closed', () => {
  // On macOS, apps usually stay alive until Cmd+Q
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createMainWindow();
  }
});

app.on('before-quit', async (e) => {
  if (!backend.status.running && ptyMgr['ptys']?.size === 0) return;
  e.preventDefault();
  try {
    ptyMgr.killAll();
    await backend.stop();
  } catch {}
  app.exit(0);
});

// Hardening --------------------------------------------------------------
app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-attach-webview', (e) => e.preventDefault());
});
