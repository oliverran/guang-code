// ============================================================
//  PTY manager — uses macOS /usr/bin/script as the PTY host
//  (avoids native node-pty module + ABI compatibility issues with Electron)
// ============================================================
import { EventEmitter } from 'node:events';
import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { PtySpawnRequest, PtyDataEvent } from '../shared/types.js';

interface PtyRecord {
  proc: ChildProcessWithoutNullStreams;
  cols: number;
  rows: number;
}

export class PtyManager extends EventEmitter {
  private ptys = new Map<string, PtyRecord>();

  async spawn(req: PtySpawnRequest): Promise<{ id: string }> {
    const id = randomUUID();
    const cols = Math.max(20, req.cols | 0);
    const rows = Math.max(5, req.rows | 0);
    const shell = req.shell ?? this.defaultShell();

    // `/usr/bin/script` is a built-in macOS tool that records a terminal
    // session. With `-q` it stays silent and pipes the PTY through stdin/stdout.
    // The `-F` flag flushes output immediately. `ttype` is unused; we just need
    // a TTY allocator.
    const proc = spawn(
      '/usr/bin/script',
      ['-q', '-F', '/dev/null', `/usr/bin/env`, 'TERM=xterm-256color', shell],
      {
        cwd: req.cwd,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLUMNS: String(cols),
          LINES: String(rows),
        } as NodeJS.ProcessEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    ) as ChildProcessWithoutNullStreams;

    this.ptys.set(id, { proc, cols, rows });

    proc.stdout.on('data', (chunk: Buffer) => {
      this.emit('data', { id, data: chunk.toString('utf8') } as PtyDataEvent);
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      // `/usr/bin/script` writes to stderr in some macOS versions; treat as output.
      this.emit('data', { id, data: chunk.toString('utf8') } as PtyDataEvent);
    });
    proc.on('exit', (code) => {
      this.ptys.delete(id);
      this.emit('exit', { id, code: code ?? 0 });
    });

    return { id };
  }

  write(id: string, data: string): void {
    const rec = this.ptys.get(id);
    if (!rec) return;
    try {
      rec.proc.stdin.write(data);
    } catch {}
  }

  resize(id: string, cols: number, rows: number): void {
    const rec = this.ptys.get(id);
    if (!rec) return;
    rec.cols = Math.max(20, cols | 0);
    rec.rows = Math.max(5, rows | 0);
    // `/usr/bin/script` does not support runtime SIGWINCH-style resize via
    // stdin; xterm.js will simply redraw at the new dimensions next frame.
  }

  kill(id: string): void {
    const rec = this.ptys.get(id);
    if (!rec) return;
    try { rec.proc.kill('SIGTERM'); } catch {}
    this.ptys.delete(id);
  }

  killAll(): void {
    for (const rec of this.ptys.values()) {
      try { rec.proc.kill('SIGTERM'); } catch {}
    }
    this.ptys.clear();
  }

  private defaultShell(): string {
    if (process.platform === 'win32') return process.env.COMSPEC || 'cmd.exe';
    return process.env.SHELL || '/bin/zsh';
  }
}
