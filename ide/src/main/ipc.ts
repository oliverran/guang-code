// ============================================================
//  IPC handler registry — wires main-side services to renderer
// ============================================================
import { ipcMain, dialog, app, BrowserWindow } from 'electron';
import { IPC } from '../shared/types.js';
import { BackendManager } from './backend';
import {
  listTree, readFileSafe, writeFileSafe,
  createFileSafe, createDirSafe, deleteSafe, renameSafe,
} from './fs';
import { PtyManager } from './terminal';

interface SseClient {
  requestId: string;
  controller: AbortController;
}

/** Proxy SSE chat stream from the backend to the renderer via IPC */
function wireChatProxy(backend: BackendManager, getMainWindow: () => BrowserWindow | null) {
  const active = new Map<string, SseClient>();

  ipcMain.handle(IPC.chatStart, async (_evt, args: { requestId: string; sessionId: string | null; message: string; cwd: string }) => {
    const status = backend.status;
    if (!status.running || !status.url) throw new Error('Backend not ready');

    const controller = new AbortController();
    active.set(args.requestId, { requestId: args.requestId, controller });

    const url = `${status.url}/api/ui/chat`;
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({
        sessionId: args.sessionId,
        message: args.message,
        cwd: args.cwd,
      }),
      signal: controller.signal,
    }).then(async (res) => {
      if (!res.ok || !res.body) {
        getMainWindow()?.webContents.send(IPC.chatEvent, args.requestId, {
          type: 'error',
          message: `Backend returned ${res.status}`,
        });
        active.delete(args.requestId);
        return;
      }
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder();
      let buf = '';
      // Map backend SSE event names → renderer ChatEvent.type
      const mapEvtType = (name: string, payload: any): any => {
        if (!name) return payload;
        switch (name) {
          case 'session':         return { type: 'session', id: args.requestId, sessionId: payload?.sessionId };
          case 'user_message':    return { type: 'user_message', id: args.requestId, content: payload?.content };
          case 'text_delta':      return { type: 'content_delta', id: args.requestId, delta: payload?.text ?? '' };
          case 'tool_start':      return { type: 'tool_call_start', id: args.requestId, toolCallId: payload?.id, toolName: payload?.toolName, input: payload?.input ?? {} };
          case 'tool_delta':      return { type: 'tool_call_delta', id: args.requestId, toolCallId: payload?.id, delta: payload?.delta ?? '' };
          case 'tool_done':       return { type: 'tool_call_done', id: args.requestId, toolCallId: payload?.id, output: payload?.toolResult };
          case 'permission_request':
            return {
              type: 'permission_request',
              id: args.requestId,
              toolCallId: payload?.id ?? payload?.toolCallId,
              toolName: payload?.tool ?? payload?.toolName,
              input: payload?.input,
              reason: payload?.reason,
            };
          case 'permission_resolved':
            return { type: 'permission_resolved', id: args.requestId, toolCallId: payload?.toolCallId, decision: payload?.decision };
          case 'done':            return { type: 'message_done', id: args.requestId, stopReason: 'done' };
          case 'final':           return { type: 'message_done', id: args.requestId, stopReason: 'final' };
          case 'error':           return { type: 'error', id: args.requestId, message: payload?.error ?? String(payload) };
          default:                return { type: name, id: args.requestId, ...payload };
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        // SSE frames separated by blank line
        let idx;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          let evtName = '';
          let dataLine = '';
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) evtName = line.slice(6).trim();
            else if (line.startsWith('data:')) dataLine += line.slice(5).trim();
          }
          if (!dataLine || dataLine === '[DONE]') continue;
          try {
            const parsed = JSON.parse(dataLine);
            const ev = mapEvtType(evtName, parsed);
            getMainWindow()?.webContents.send(IPC.chatEvent, args.requestId, ev);
          } catch {
            // ignore malformed frame
          }
        }
      }
      getMainWindow()?.webContents.send(IPC.chatEvent, args.requestId, { type: 'message_done', id: args.requestId });
      active.delete(args.requestId);
    }).catch((err) => {
      if ((err as Error).name === 'AbortError') return;
      getMainWindow()?.webContents.send(IPC.chatEvent, args.requestId, { type: 'error', message: String(err) });
      active.delete(args.requestId);
    });

    return args.requestId;
  });

  ipcMain.handle(IPC.chatCancel, async (_evt, requestId: string) => {
    const c = active.get(requestId);
    if (c) {
      c.controller.abort();
      active.delete(requestId);
    }
  });

  ipcMain.handle(IPC.permissionDecide, async (_evt, args: { requestId: string; toolCallId: string; decision: 'allow' | 'deny' }) => {
    // Emit a synthetic event back to the SSE stream; the actual backend permission
    // resolution is handled inside webServer's existing flow. For now we surface
    // the decision so the renderer can clear the UI.
    getMainWindow()?.webContents.send(IPC.chatEvent, args.requestId, {
      type: 'permission_resolved',
      id: args.requestId,
      toolCallId: args.toolCallId,
      decision: args.decision,
    });
  });
}

/** Wire file system IPC */
function wireFs() {
  ipcMain.handle(IPC.fsListTree, async (_evt, rootPath: string, maxDepth?: number) => listTree(rootPath, maxDepth));
  ipcMain.handle(IPC.fsReadFile, async (_evt, filePath: string) => readFileSafe(filePath));
  ipcMain.handle(IPC.fsWriteFile, async (_evt, filePath: string, content: string) => writeFileSafe(filePath, content));
  ipcMain.handle(IPC.fsCreateFile, async (_evt, filePath: string) => createFileSafe(filePath));
  ipcMain.handle(IPC.fsCreateDir, async (_evt, dirPath: string) => createDirSafe(dirPath));
  ipcMain.handle(IPC.fsDelete, async (_evt, targetPath: string) => deleteSafe(targetPath));
  ipcMain.handle(IPC.fsRename, async (_evt, oldPath: string, newPath: string) => renameSafe(oldPath, newPath));
}

/** Wire PTY IPC */
function wirePty(ptyMgr: PtyManager) {
  ipcMain.handle(IPC.ptySpawn, async (_evt, req) => ptyMgr.spawn(req));
  ipcMain.on(IPC.ptyWrite, (_evt, id: string, data: string) => ptyMgr.write(id, data));
  ipcMain.on(IPC.ptyResize, (_evt, id: string, cols: number, rows: number) => ptyMgr.resize(id, cols, rows));
  ipcMain.on(IPC.ptyKill, (_evt, id: string) => ptyMgr.kill(id));

  ptyMgr.on('data', (ev) => {
    BrowserWindow.getAllWindows().forEach((w) => w.webContents.send(IPC.ptyData, ev));
  });
  ptyMgr.on('exit', (ev) => {
    BrowserWindow.getAllWindows().forEach((w) => w.webContents.send(IPC.ptyExit, ev));
  });
}

/** Wire backend lifecycle */
function wireBackend(backend: BackendManager, getMainWindow: () => BrowserWindow | null) {
  ipcMain.handle(IPC.backendStart, async () => backend.start());
  ipcMain.handle(IPC.backendStop, async () => { await backend.stop(); });
  ipcMain.handle(IPC.backendStatus, async () => backend.status);

  backend.on('status', (status) => {
    getMainWindow()?.webContents.send('backend:status-changed', status);
  });
}

/** Wire app-level queries */
function wireApp() {
  ipcMain.handle('app:platform', async () => process.platform);
  ipcMain.handle('app:versions', async () => ({
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  }));
  ipcMain.handle('app:open-project-dialog', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Open Project Folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0];
  });
}

export function registerIpc(opts: {
  backend: BackendManager;
  ptyMgr: PtyManager;
  getMainWindow: () => BrowserWindow | null;
}) {
  wireBackend(opts.backend, opts.getMainWindow);
  wireFs();
  wirePty(opts.ptyMgr);
  wireChatProxy(opts.backend, opts.getMainWindow);
  wireApp();
}
