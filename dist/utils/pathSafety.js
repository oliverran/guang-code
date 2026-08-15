import path from 'path';
import { realpath, stat } from 'fs/promises';
import fs from 'fs';
export function isUncPath(p) {
    const s = (p ?? '').trim().replace(/\//g, '\\');
    return s.startsWith('\\\\');
}
export function resolveAgainstCwd(cwd, p) {
    const raw = (p ?? '').toString().trim();
    return path.resolve(cwd, raw);
}
export function isPathWithin(baseDir, targetPath) {
    const base = path.resolve(baseDir);
    const target = path.resolve(targetPath);
    if (process.platform === 'win32') {
        const b = base.toLowerCase();
        const t = target.toLowerCase();
        if (t === b)
            return true;
        return t.startsWith(b.endsWith(path.sep) ? b : b + path.sep);
    }
    if (target === base)
        return true;
    return target.startsWith(base.endsWith(path.sep) ? base : base + path.sep);
}
export function isProtectedProjectFile(opts) {
    const rel = path.relative(opts.cwd, opts.absPath).replace(/\\/g, '/');
    const top = rel.split('/')[0];
    if (top === '.guang')
        return true;
    if (top === '.git')
        return true;
    return false;
}
export function assertSafeLocalPath(opts) {
    const abs = resolveAgainstCwd(opts.cwd, opts.inputPath);
    if (!opts.allowUnc && isUncPath(abs)) {
        throw new Error('UNC paths are blocked for safety.');
    }
    if (!isPathWithin(opts.cwd, abs)) {
        throw new Error('Path is outside the current working directory.');
    }
    return abs;
}
export function validateGlobPattern(pattern) {
    const p = (pattern ?? '').toString();
    if (!p.trim())
        return { ok: false, reason: 'Empty pattern.' };
    if (/(^|[\\/])\.\.([\\/]|$)/.test(p))
        return { ok: false, reason: 'Parent directory traversal ("..") is not allowed.' };
    if (isUncPath(p))
        return { ok: false, reason: 'UNC paths are blocked for safety.' };
    return { ok: true };
}
export async function resolveRealPathWithinCwd(opts) {
    const cwdReal = await safeRealpath(opts.cwd);
    const deepest = await deepestExistingAncestor(opts.absPath);
    const deepestReal = await safeRealpath(deepest);
    if (!isPathWithin(cwdReal, deepestReal)) {
        throw new Error('Path resolves outside the current working directory.');
    }
    return opts.absPath;
}
async function safeRealpath(p) {
    try {
        return await realpath(p);
    }
    catch {
        return path.resolve(p);
    }
}
async function deepestExistingAncestor(p) {
    let cur = path.resolve(p);
    while (true) {
        try {
            await stat(cur);
            return cur;
        }
        catch {
            const parent = path.dirname(cur);
            if (parent === cur)
                return cur;
            cur = parent;
        }
    }
}
export function isLikelyTextFileExt(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (!ext)
        return true;
    const textExts = new Set([
        '.txt', '.md', '.js', '.ts', '.tsx', '.jsx', '.json', '.yml', '.yaml', '.toml', '.ini',
        '.css', '.scss', '.html', '.xml', '.py', '.go', '.rs', '.java', '.c', '.cc', '.cpp', '.h', '.hpp',
        '.sh', '.ps1', '.bat', '.cmd', '.sql', '.graphql',
    ]);
    return textExts.has(ext);
}
export function isSymlinkSync(p) {
    try {
        return fs.lstatSync(p).isSymbolicLink();
    }
    catch {
        return false;
    }
}
