import fs from 'fs';
import path from 'path';
import { homedir } from 'os';
import { parseFrontmatter } from './customCommands.js';
function safeRead(filePath) {
    try {
        const stat = fs.statSync(filePath);
        if (!stat.isFile())
            return null;
        const raw = fs.readFileSync(filePath, 'utf-8');
        return raw.trim() ? raw : null;
    }
    catch {
        return null;
    }
}
function parseAllowedTools(v) {
    if (Array.isArray(v))
        return v.map(String).filter(Boolean);
    if (typeof v === 'string') {
        const parts = v.split(',').map(s => s.trim()).filter(Boolean);
        return parts.length ? parts : undefined;
    }
    return undefined;
}
function parseArguments(v) {
    if (Array.isArray(v))
        return v.map(String).filter(Boolean);
    if (typeof v === 'string') {
        const parts = v.split(',').map(s => s.trim()).filter(Boolean);
        return parts.length ? parts : undefined;
    }
    return undefined;
}
function parseSkillMarkdown(raw) {
    return parseFrontmatter(raw);
}
function buildSkillFromFile(opts) {
    const raw = safeRead(opts.filePath);
    if (!raw)
        return null;
    const { frontmatter, content } = parseSkillMarkdown(raw);
    const userInvocable = frontmatter['user-invocable'] !== false;
    if (!userInvocable)
        return null;
    const name = (typeof frontmatter.name === 'string' && frontmatter.name.trim())
        ? frontmatter.name.trim()
        : opts.id;
    const description = (typeof frontmatter.description === 'string' && frontmatter.description.trim())
        ? frontmatter.description.trim()
        : (() => {
            const first = content.trim().split('\n').find(Boolean) ?? '';
            return first.slice(0, 160) || `Skill loaded from ${path.basename(opts.filePath)}`;
        })();
    const allowedTools = parseAllowedTools(frontmatter['allowed-tools']);
    const argumentsList = parseArguments(frontmatter.arguments);
    const argumentHint = typeof frontmatter['argument-hint'] === 'string'
        ? String(frontmatter['argument-hint']).trim()
        : undefined;
    return {
        id: opts.id,
        name,
        description,
        prompt: content.trim(),
        allowedTools,
        arguments: argumentsList,
        argumentHint,
        userInvocable: true,
        sourcePath: opts.filePath,
    };
}
function loadSkillsFromDir(baseDir) {
    try {
        if (!fs.existsSync(baseDir))
            return [];
        const stat = fs.statSync(baseDir);
        if (!stat.isDirectory())
            return [];
    }
    catch {
        return [];
    }
    const out = [];
    const entries = fs.readdirSync(baseDir);
    for (const entry of entries) {
        const skillDir = path.join(baseDir, entry);
        try {
            const st = fs.statSync(skillDir);
            if (!st.isDirectory())
                continue;
        }
        catch {
            continue;
        }
        const filePath = path.join(skillDir, 'SKILL.md');
        const skill = buildSkillFromFile({ id: entry, filePath });
        if (skill)
            out.push(skill);
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
}
export function loadAllSkills(cwd) {
    const userDir = path.join(homedir(), '.guang-code', 'skills');
    const projectDir = path.join(cwd, '.guang', 'skills');
    const userSkills = loadSkillsFromDir(userDir);
    const projectSkills = loadSkillsFromDir(projectDir);
    const byId = new Map();
    for (const s of userSkills)
        byId.set(s.id, s);
    for (const s of projectSkills)
        byId.set(s.id, s);
    return Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));
}
export function renderSkillInvocation(skill, args) {
    const argText = args.trim() ? `\n\nUser provided arguments:\n${args.trim()}\n` : '';
    const toolsText = skill.allowedTools && skill.allowedTools.length
        ? `\n\nAllowed tools: ${skill.allowedTools.join(', ')}\n`
        : '';
    const hintText = skill.argumentHint ? `\n\nArgument hint: ${skill.argumentHint}\n` : '';
    return [
        `[System: Executing skill /skill ${skill.id}]`,
        toolsText.trim() ? toolsText.trim() : '',
        hintText.trim() ? hintText.trim() : '',
        argText.trim() ? argText.trim() : '',
        '',
        skill.prompt,
    ].filter(Boolean).join('\n');
}
