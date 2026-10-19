// ============================================================
//  Preload — bridges main process to renderer via contextBridge
//  Runs in an isolated context; only the `guang` API is exposed.
// ============================================================
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
// We keep the explicit .js suffix in the source so that the CommonJS output
// resolves correctly when Electron loads the preload script from dist/.
import { IPC, GuangApi, BackendStatus, ChatEvent, PtyDataEvent } from '../shared/types.js';

const api: GuangApi = {
  backend: {
    start: () => ipcRenderer.invoke(IPC.backendStart) as Promise<BackendStatus>,
    stop: () => ipcRenderer.invoke(IPC.backendStop) as Promise<void>,
    status: () => ipcRenderer.invoke(IPC.backendStatus) as Promise<BackendStatus>,
    onStatusChange: (cb) => {
      const listener = (_e: IpcRendererEvent, status: BackendStatus) => cb(status);
      ipcRenderer.on('backend:status-changed', listener);
      return () => ipcRenderer.off('backend:status-changed', listener);
    },
  },
  fs: {
    listTree: (rootPath: string, maxDepth?: number) => ipcRenderer.invoke(IPC.fsListTree, rootPath, maxDepth) as Promise<any>,
    readFile: (filePath: string) => ipcRenderer.invoke(IPC.fsReadFile, filePath) as Promise<any>,
    writeFile: (filePath: string, content: string) => ipcRenderer.invoke(IPC.fsWriteFile, filePath, content) as Promise<void>,
    createFile: (filePath: string) => ipcRenderer.invoke(IPC.fsCreateFile, filePath) as Promise<void>,
    createDir: (dirPath: string) => ipcRenderer.invoke(IPC.fsCreateDir, dirPath) as Promise<void>,
    delete: (targetPath: string) => ipcRenderer.invoke(IPC.fsDelete, targetPath) as Promise<void>,
    rename: (oldPath: string, newPath: string) => ipcRenderer.invoke(IPC.fsRename, oldPath, newPath) as Promise<void>,
  },
  chat: {
    start: (sessionId: string | null, message: string, ctx: { cwd: string }) =>
      ipcRenderer.invoke(IPC.chatStart, {
        requestId: cryptoRandomId(),
        sessionId,
        message,
        cwd: ctx.cwd,
      }) as Promise<string>,
    cancel: (requestId: string) => ipcRenderer.invoke(IPC.chatCancel, requestId) as Promise<void>,
    onEvent: (cb: (requestId: string, ev: ChatEvent) => void) => {
      const listener = (_e: IpcRendererEvent, requestId: string, ev: ChatEvent) => cb(requestId, ev);
      ipcRenderer.on(IPC.chatEvent, listener);
      return () => ipcRenderer.off(IPC.chatEvent, listener);
    },
    permissionDecide: (requestId: string, toolCallId: string, decision: 'allow' | 'deny') =>
      ipcRenderer.invoke(IPC.permissionDecide, { requestId, toolCallId, decision }) as Promise<void>,
  },
  terminal: {
    spawn: (req: any) => ipcRenderer.invoke(IPC.ptySpawn, req) as Promise<{ id: string }>,
    write: (id: string, data: string) => ipcRenderer.send(IPC.ptyWrite, id, data),
    resize: (id: string, cols: number, rows: number) => ipcRenderer.send(IPC.ptyResize, id, cols, rows),
    kill: (id: string) => ipcRenderer.send(IPC.ptyKill, id),
    onData: (cb) => {
      const listener = (_e: IpcRendererEvent, ev: PtyDataEvent) => cb(ev);
      ipcRenderer.on(IPC.ptyData, listener);
      return () => ipcRenderer.off(IPC.ptyData, listener);
    },
    onExit: (cb) => {
      const listener = (_e: IpcRendererEvent, ev: { id: string; code: number }) => cb(ev);
      ipcRenderer.on(IPC.ptyExit, listener);
      return () => ipcRenderer.off(IPC.ptyExit, listener);
    },
  },
  app: {
    platform: () => ipcRenderer.invoke('app:platform') as Promise<NodeJS.Platform>,
    versions: () => ipcRenderer.invoke('app:versions') as Promise<{ node: string; chrome: string; electron: string }>,
    openProjectDialog: () => ipcRenderer.invoke('app:open-project-dialog') as Promise<string | null>,
  },
};

contextBridge.exposeInMainWorld('guang', api);

function cryptoRandomId(): string {
  // 12-char random id without depending on crypto in the preload sandbox
  const a = Math.random().toString(36).slice(2, 8);
  const b = Math.random().toString(36).slice(2, 8);
  return `${a}${b}`;
}
