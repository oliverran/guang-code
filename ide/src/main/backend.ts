// ============================================================
//  Backend manager — spawns webServer.js as child process
//  Reuses the existing dist/utils/webServer.js entry point
// ============================================================
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { BackendStatus } from '../shared/types.js';

type ChildProc = ReturnType<typeof spawn>;

const READY_TIMEOUT_MS = 15_000;

export interface BackendManagerOptions {
  /** Project root that contains dist/ and scripts/ */
  projectRoot: string;
  /** Default 5174 (avoids collision with Vite dev server on 5173) */
  defaultPort?: number;
  /** Force a fixed port (otherwise picked automatically) */
  port?: number;
  /** '127.0.0.1' by default */
  host?: string;
}

export class BackendManager extends EventEmitter {
  private proc: ChildProc | null = null;
  private _status: BackendStatus = { running: false, port: null, url: null, pid: null };
  private buffer = '';
  private readyPromise: Promise<void> | null = null;

  constructor(private opts: BackendManagerOptions) {
    super();
    this.opts.defaultPort = opts.defaultPort ?? 5174;
    this.opts.host = opts.host ?? '127.0.0.1';
  }

  get status(): BackendStatus {
    return { ...this._status };
  }

  /** Start the backend (idempotent — returns existing if already running) */
  async start(): Promise<BackendStatus> {
    if (this.proc && this._status.running) {
      return this.status;
    }
    const port = this.opts.port ?? this.opts.defaultPort!;
    const scriptPath = path.join(this.opts.projectRoot, 'scripts', 'start-ui.mjs');

    // Clear buffer before spawn
    this.buffer = '';
    this.readyPromise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Backend did not become ready within ${READY_TIMEOUT_MS}ms (port=${port})`));
      }, READY_TIMEOUT_MS);

      const proc = spawn(process.execPath, [scriptPath, `--port=${port}`, `--host=${this.opts.host}`, '--no-open'], {
        cwd: this.opts.projectRoot,
        env: {
          ...process.env,
          // Disable any global ink/colour that might confuse parsing
          FORCE_COLOR: '0',
          // Mark the child so it knows it's spawned by the IDE
          GUANG_IDE_CHILD: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this.proc = proc;
      this._status = { running: false, port, url: null, pid: proc.pid ?? null };

      const onChunk = (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        this.buffer += text;
        // Look for URL hint in banner
        const m = this.buffer.match(/URL\s*:\s*(http:\/\/[^\s]+)/i);
        if (m && !this._status.running) {
          this._status = { running: true, port, url: m[1], pid: proc.pid ?? null };
          clearTimeout(timer);
          this.emit('status', this.status);
          resolve();
        }
      };

      proc.stdout.on('data', onChunk);
      proc.stderr.on('data', (c) => {
        const t = c.toString('utf8');
        this.buffer += t;
        // EADDRINUSE → fast-fail
        if (this.buffer.includes('EADDRINUSE') || this.buffer.includes('Port') && this.buffer.includes('already in use')) {
          clearTimeout(timer);
          reject(new Error(`Port ${port} already in use`));
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        this._status = { running: false, port: null, url: null, pid: null, error: String(err) };
        this.emit('status', this.status);
        reject(err);
      });

      proc.on('exit', (code) => {
        const wasRunning = this._status.running;
        this.proc = null;
        this._status = { running: false, port: null, url: null, pid: null };
        this.emit('status', this.status);
        if (wasRunning) {
          // Unexpected exit while we thought it was up
          this.emit('exit', code);
        }
      });
    });

    try {
      await this.readyPromise;
    } catch (err) {
      // Cleanup on failure
      if (this.proc) {
        try { this.proc.kill('SIGTERM'); } catch {}
        this.proc = null;
      }
      this._status = { running: false, port: null, url: null, pid: null, error: String(err) };
      this.emit('status', this.status);
      throw err;
    }

    return this.status;
  }

  /** Stop the backend (no-op if not running) */
  async stop(): Promise<void> {
    if (!this.proc) return;
    return new Promise<void>((resolve) => {
      const proc = this.proc!;
      const timer = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch {}
        resolve();
      }, 3_000);
      proc.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      try { proc.kill('SIGTERM'); } catch {}
    });
  }

  /** Quick health check (ping the running backend) */
  async ping(): Promise<boolean> {
    if (!this._status.url) return false;
    try {
      const res = await fetch(`${this._status.url}/sdk/info`, { method: 'GET' });
      return res.ok;
    } catch {
      return false;
    }
  }
}
