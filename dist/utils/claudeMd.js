import fs from 'fs';
import path from 'path';
import { homedir } from 'os';
const MAX_SINGLE_FILE_CHARS = 40000;
const MAX_TOTAL_CHARS = 140000;
const TEXT_FILE_EXTENSIONS = new Set([
    '.md',
    '.txt',
    '.text',
    '.json',
    '.yaml',
    '.yml',
    '.toml',
    '.xml',
    '.csv',
    '.html',
    '.htm',
    '.css',
    '.js',
    '.ts',
    '.tsx',
    '.jsx',
    '.mjs',
    '.cjs',
    '.py',
    '.rb',
    '.go',
    '.rs',
    '.java',
    '.kt',
    '.cs',
    '.swift',
    '.sh',
    '.bash',
    '.zsh',
    '.fish',
    '.ps1',
    '.bat',
    '.cmd',
    '.env',
    '.ini',
    '.cfg',
    '.conf',
    '.properties',
    '.sql',
    '.graphql',
    '.gql',
]);
function getAncestors(startDir) {
    const out = [];
    let cur = path.resolve(startDir);
    while (true) {
        out.push(cur);
        const parent = path.dirname(cur);
        if (parent === cur)
            break;
        cur = parent;
    }
    return out;
}
function safeReadTextFile(filePath) {
    try {
        const stat = fs.statSync(filePath);
        if (!stat.isFile())
            return null;
        const raw = fs.readFileSync(filePath, 'utf-8');
        if (!raw.trim())
            return null;
        if (raw.length <= MAX_SINGLE_FILE_CHARS)
            return raw;
        return raw.slice(0, MAX_SINGLE_FILE_CHARS) + '\n\n[...truncated]\n';
    }
    catch {
        return null;
    }
}
function isTextFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return TEXT_FILE_EXTENSIONS.has(ext);
}
function resolveIncludePath(rawPath, baseDir) {
    const trimmed = rawPath.trim();
    if (!trimmed)
        return null;
    let expanded = trimmed;
    if (expanded.startsWith('~/') || expanded === '~') {
        expanded = path.join(homedir(), expanded.slice(2));
    }
    const isAbs = path.isAbsolute(expanded) ||
        /^[a-zA-Z]:[\\/]/.test(expanded) ||
        expanded.startsWith('\\\\');
    if (isAbs)
        return path.normalize(expanded);
    return path.normalize(path.resolve(baseDir, expanded));
}
function expandIncludes(markdown, baseDir, seen) {
    const sources = [];
    let total = 0;
    const outLines = [];
    const lines = markdown.split('\n');
    let inFence = false;
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
            inFence = !inFence;
            outLines.push(line);
            continue;
        }
        if (!inFence && trimmed.startsWith('@') && trimmed.length > 1) {
            const includeTarget = trimmed.slice(1).trim();
            const includePath = resolveIncludePath(includeTarget, baseDir);
            if (!includePath)
                continue;
            if (!isTextFile(includePath))
                continue;
            if (seen.has(includePath))
                continue;
            seen.add(includePath);
            const included = safeReadTextFile(includePath);
            if (!included)
                continue;
            const expanded = expandIncludes(included, path.dirname(includePath), seen);
            sources.push(includePath, ...expanded.sources);
            const block = `\n[Included: ${includePath}]\n${expanded.text}\n[End Included: ${includePath}]\n`;
            total += block.length;
            if (total > MAX_TOTAL_CHARS)
                break;
            outLines.push(block);
            continue;
        }
        total += line.length + 1;
        if (total > MAX_TOTAL_CHARS)
            break;
        outLines.push(line);
    }
    return { text: outLines.join('\n').trim(), sources };
}
function listRuleFiles(dir) {
    try {
        const stat = fs.statSync(dir);
        if (!stat.isDirectory())
            return [];
    }
    catch {
        return [];
    }
    try {
        const files = fs.readdirSync(dir);
        return files
            .filter(f => f.toLowerCase().endsWith('.md'))
            .map(f => path.join(dir, f))
            .sort((a, b) => a.localeCompare(b));
    }
    catch {
        return [];
    }
}
function collectCandidateFilesForDir(dir) {
    const project = [];
    const local = [];
    const candidatesProject = [
        path.join(dir, 'GUANG.md'),
        path.join(dir, 'CLAUDE.md'),
        path.join(dir, '.claude', 'CLAUDE.md'),
    ];
    for (const p of candidatesProject) {
        if (fs.existsSync(p))
            project.push(p);
    }
    const rulesDir = path.join(dir, '.claude', 'rules');
    project.push(...listRuleFiles(rulesDir));
    const localFile = path.join(dir, 'CLAUDE.local.md');
    if (fs.existsSync(localFile))
        local.push(localFile);
    return { project, local };
}
function loadFilesInOrder(filePaths, seen) {
    const parts = [];
    const sources = [];
    let total = 0;
    for (const fp of filePaths) {
        const abs = path.resolve(fp);
        if (seen.has(abs))
            continue;
        seen.add(abs);
        const raw = safeReadTextFile(abs);
        if (!raw)
            continue;
        const expanded = expandIncludes(raw, path.dirname(abs), new Set([abs]));
        const text = expanded.text;
        if (!text.trim())
            continue;
        const block = `\n[Source: ${abs}]\n${text}\n`;
        total += block.length;
        if (total > MAX_TOTAL_CHARS)
            break;
        parts.push(block);
        sources.push(abs, ...expanded.sources);
    }
    return { text: parts.join('\n').trim(), sources: Array.from(new Set(sources)) };
}
export function loadAllInstructions(cwd) {
    const seen = new Set();
    const allFiles = [];
    const home = homedir();
    const userClaude = path.join(home, '.claude', 'CLAUDE.md');
    if (fs.existsSync(userClaude))
        allFiles.push(userClaude);
    allFiles.push(...listRuleFiles(path.join(home, '.claude', 'rules')));
    const ancestors = getAncestors(cwd).reverse();
    const projectFiles = [];
    const localFiles = [];
    for (const dir of ancestors) {
        const { project, local } = collectCandidateFilesForDir(dir);
        projectFiles.push(...project);
        localFiles.push(...local);
    }
    allFiles.push(...projectFiles, ...localFiles);
    const loaded = loadFilesInOrder(allFiles, seen);
    if (!loaded.text.trim())
        return null;
    return loaded;
}
