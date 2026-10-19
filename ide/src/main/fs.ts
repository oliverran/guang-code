// ============================================================
//  File system helpers used by IPC handlers
//  We intentionally bypass the backend for file I/O so the
//  editor stays responsive even before the AI backend is up.
// ============================================================
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { FsEntry, OpenFile } from '../shared/types.js';

/** Map a file extension to a Monaco language id */
const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', jsonc: 'json',
  html: 'html', htm: 'html', css: 'css', scss: 'scss', less: 'less',
  md: 'markdown', mdx: 'markdown',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', swift: 'swift',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
  cs: 'csharp', php: 'php', sql: 'sql', sh: 'shell', bash: 'shell', zsh: 'shell', ps1: 'powershell',
  yaml: 'yaml', yml: 'yaml', toml: 'ini', xml: 'xml', vue: 'vue', svelte: 'svelte',
  txt: 'plaintext', log: 'plaintext', env: 'plaintext',
};

export function languageForPath(filePath: string): string {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return EXT_TO_LANG[ext] ?? 'plaintext';
}

/** Recursively list files under root. */
export async function listTree(rootPath: string, maxDepth = 8, depth = 0): Promise<FsEntry> {
  const stat = await fs.stat(rootPath).catch(() => null);
  if (!stat) throw new Error(`Path not found: ${rootPath}`);
  const baseName = path.basename(rootPath);
  const entry: FsEntry = {
    name: baseName,
    path: rootPath,
    relativePath: baseName,
    isDirectory: stat.isDirectory(),
    isFile: stat.isFile(),
    size: stat.size,
    mtime: stat.mtimeMs,
  };
  if (!stat.isDirectory() || depth >= maxDepth) return entry;
  const items = await fs.readdir(rootPath, { withFileTypes: true });
  // Skip noisy / heavy directories by default
  const SKIP = new Set(['node_modules', '.git', 'dist', '.next', '.cache', '.parcel-cache', '.turbo', 'coverage', '.venv', '__pycache__']);
  const sorted = items
    .filter((d) => !SKIP.has(d.name) && !d.name.startsWith('.DS_'))
    .sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  entry.children = [];
  for (const d of sorted) {
    const childPath = path.join(rootPath, d.name);
    try {
      const child = await listTree(childPath, maxDepth, depth + 1);
      child.relativePath = path.relative(rootPath, childPath);
      entry.children.push(child);
    } catch (err) {
      // Skip unreadable entries silently
    }
  }
  return entry;
}

export async function readFileSafe(filePath: string): Promise<OpenFile> {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new Error(`Not a file: ${filePath}`);
  const content = await fs.readFile(filePath, 'utf8');
  // Derive a project-relative path by walking up to the first folder that looks
  // like a project root (contains .git / package.json / README.md). Falls back
  // to the absolute path when nothing matches.
  let rel = filePath;
  let dir = path.dirname(filePath);
  while (dir !== path.dirname(dir)) {
    try {
      const entries = await fs.readdir(dir);
      if (entries.includes('.git') || entries.includes('package.json') || entries.some((e) => /^README\.md$/i.test(e))) {
        rel = path.relative(dir, filePath);
        break;
      }
    } catch {}
    dir = path.dirname(dir);
  }
  return {
    path: filePath,
    relativePath: rel,
    language: languageForPath(filePath),
    content,
    dirty: false,
    readonly: false,
  };
}

export async function writeFileSafe(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

export async function createFileSafe(filePath: string): Promise<void> {
  if (fsSync.existsSync(filePath)) throw new Error(`Already exists: ${filePath}`);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, '', 'utf8');
}

export async function createDirSafe(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function deleteSafe(targetPath: string): Promise<void> {
  await fs.rm(targetPath, { recursive: true, force: true });
}

export async function renameSafe(oldPath: string, newPath: string): Promise<void> {
  await fs.mkdir(path.dirname(newPath), { recursive: true });
  await fs.rename(oldPath, newPath);
}
