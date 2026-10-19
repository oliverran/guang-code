// ============================================================
//  Guang Code IDE — Shared types (main ↔ preload ↔ renderer)
// ============================================================

/** File system entry from FileTree */
export interface FsEntry {
  name: string;
  path: string;            // absolute path
  relativePath: string;    // relative to project root
  isDirectory: boolean;
  isFile: boolean;
  size: number;
  mtime: number;
  children?: FsEntry[];    // only for directories
}

/** Open file in editor */
export interface OpenFile {
  path: string;
  relativePath: string;
  language: string;
  content: string;
  dirty: boolean;
  readonly: boolean;
}

/** Backend status */
export interface BackendStatus {
  running: boolean;
  port: number | null;
  url: string | null;
  pid: number | null;
  error?: string;
}

/** Chat message types (mirror of web UI SSE events) */
export type ChatEvent =
  | { type: 'message_start'; id: string; role: 'assistant' }
  | { type: 'content_delta'; id: string; delta: string }
  | { type: 'content_done'; id: string; content: string }
  | { type: 'tool_call_start'; id: string; toolCallId: string; toolName: string; input: unknown }
  | { type: 'tool_call_delta'; id: string; toolCallId: string; delta: string }
  | { type: 'tool_call_done'; id: string; toolCallId: string; output: unknown }
  | { type: 'permission_request'; id: string; toolCallId: string; toolName: string; input: unknown; reason?: string }
  | { type: 'permission_resolved'; id: string; toolCallId: string; decision: 'allow' | 'deny' }
  | { type: 'message_done'; id: string; stopReason?: string }
  | { type: 'error'; id?: string; message: string };

/** Terminal pty lifecycle */
export interface PtySpawnRequest {
  cols: number;
  rows: number;
  cwd: string;
  shell?: string;
}

export interface PtyDataEvent {
  id: string;
  data: string;
}

/** IPC channel names (shared constants) */
export const IPC = {
  // backend
  backendStart: 'backend:start',
  backendStop: 'backend:stop',
  backendStatus: 'backend:status',

  // fs
  fsListTree: 'fs:list-tree',
  fsReadFile: 'fs:read-file',
  fsWriteFile: 'fs:write-file',
  fsCreateFile: 'fs:create-file',
  fsCreateDir: 'fs:create-dir',
  fsDelete: 'fs:delete',
  fsRename: 'fs:rename',
  fsWatch: 'fs:watch',

  // chat (proxy to backend SSE)
  chatStart: 'chat:start',
  chatCancel: 'chat:cancel',
  chatEvent: 'chat:event',          // main → renderer

  // permission
  permissionDecide: 'permission:decide',

  // terminal
  ptySpawn: 'pty:spawn',
  ptyWrite: 'pty:write',
  ptyResize: 'pty:resize',
  ptyKill: 'pty:kill',
  ptyData: 'pty:data',              // main → renderer
  ptyExit: 'pty:exit',              // main → renderer

  // app
  appReady: 'app:ready',
  appOpenProject: 'app:open-project',
} as const;

/** Exposed to renderer via contextBridge */
export interface GuangApi {
  backend: {
    start(): Promise<BackendStatus>;
    stop(): Promise<void>;
    status(): Promise<BackendStatus>;
    onStatusChange(cb: (s: BackendStatus) => void): () => void;
  };
  fs: {
    listTree(rootPath: string, maxDepth?: number): Promise<FsEntry>;
    readFile(filePath: string): Promise<OpenFile>;
    writeFile(filePath: string, content: string): Promise<void>;
    createFile(filePath: string): Promise<void>;
    createDir(dirPath: string): Promise<void>;
    delete(targetPath: string): Promise<void>;
    rename(oldPath: string, newPath: string): Promise<void>;
  };
  chat: {
    start(sessionId: string | null, message: string, ctx: { cwd: string }): Promise<string>; // returns request id
    cancel(requestId: string): Promise<void>;
    onEvent(cb: (requestId: string, ev: ChatEvent) => void): () => void;
    permissionDecide(requestId: string, toolCallId: string, decision: 'allow' | 'deny'): Promise<void>;
  };
  terminal: {
    spawn(req: PtySpawnRequest): Promise<{ id: string }>;
    write(id: string, data: string): void;
    resize(id: string, cols: number, rows: number): void;
    kill(id: string): void;
    onData(cb: (ev: PtyDataEvent) => void): () => void;
    onExit(cb: (ev: { id: string; code: number }) => void): () => void;
  };
  app: {
    platform(): Promise<NodeJS.Platform>;
    versions(): Promise<{ node: string; chrome: string; electron: string }>;
    openProjectDialog(): Promise<string | null>;
  };
}
