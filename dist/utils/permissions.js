import fs from 'fs';
import path from 'path';
import { isPreapprovedHost } from './webFetchPreapproved.js';
import { isLoopbackHost, isPrivateOrLinkLocalIp, validateUrlString } from './webFetchSafety.js';
function isMcpToolName(toolName) {
    const t = (toolName ?? '').toLowerCase();
    return t === 'mcp' || t.startsWith('mcp.') || t.startsWith('mcp:');
}
function normalizeForMatch(p) {
    return p.replace(/\\/g, '/');
}
function wildcardToRegExp(pattern) {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    const re = '^' + escaped.replace(/\\\*/g, '.*').replace(/\\\?/g, '.') + '$';
    return new RegExp(re, 'i');
}
function matchPattern(pattern, value) {
    try {
        return wildcardToRegExp(pattern).test(value);
    }
    catch {
        return false;
    }
}
export function loadProjectPermissionRules(cwd) {
    const fp = path.join(cwd, '.guang', 'permissions.json');
    if (!fs.existsSync(fp))
        return [];
    try {
        const raw = fs.readFileSync(fp, 'utf-8');
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed))
            return [];
        return parsed.filter(Boolean);
    }
    catch {
        return [];
    }
}
function toolInputPath(toolName, input, cwd) {
    if (!input)
        return null;
    const key = (toolName === 'Read' || toolName === 'Write' || toolName === 'Edit')
        ? 'file_path'
        : toolName === 'LS'
            ? 'path'
            : toolName === 'Grep'
                ? 'path'
                : null;
    if (!key)
        return null;
    const p = input[key];
    if (!p)
        return null;
    return normalizeForMatch(path.resolve(cwd, p));
}
function toolInputCommand(toolName, input) {
    if (!input)
        return null;
    if (toolName !== 'Bash')
        return null;
    const c = input.command;
    return c ? String(c) : null;
}
function toolInputDomain(toolName, input) {
    if (!input)
        return null;
    if (toolName !== 'WebFetch')
        return null;
    const raw = input.url;
    if (!raw)
        return null;
    try {
        const v = validateUrlString(raw);
        return v.hostname;
    }
    catch {
        return null;
    }
}
function isPlanWriteLikeBash(command) {
    return /\b(rm|mv|cp|mkdir|touch|tee|dd|sed\s+-i|powershell|pwsh)\b/.test(command) || />\s*[^|]/.test(command);
}
function isAutoReadOnlyBash(command) {
    const c = (command ?? '').trim();
    if (!c)
        return false;
    if (/[|&;<>`]/.test(c))
        return false;
    const allowed = [
        /^git\s+(status|diff|log|show)\b/i,
        /^git\s+rev-parse\b/i,
        /^npm\s+(-v|--version)\b/i,
        /^node\s+(-v|--version)\b/i,
        /^pnpm\s+(-v|--version)\b/i,
        /^yarn\s+(-v|--version)\b/i,
        /^npx\s+tsc\b.*--noEmit\b/i,
        /^tsc\b.*--noEmit\b/i,
    ];
    return allowed.some(r => r.test(c));
}
export function decidePermission(opts) {
    const { permissionMode, rules, toolName, toolInput, cwd, planApproved = false } = opts;
    let decision = 'ask';
    let reason;
    let matchedRule;
    if (permissionMode === 'plan' && !planApproved) {
        if (isMcpToolName(toolName)) {
            return { decision: 'deny', reason: 'Plan mode (not approved) blocks MCP tools.' };
        }
        if (toolName === 'Write' || toolName === 'Edit') {
            return { decision: 'deny', reason: 'Plan mode (not approved) blocks file writes/edits.' };
        }
        if (toolName === 'Bash') {
            const cmd = toolInputCommand(toolName, toolInput);
            if (cmd && isPlanWriteLikeBash(cmd)) {
                return { decision: 'deny', reason: 'Plan mode (not approved) blocks write-like shell commands.' };
            }
        }
    }
    if (permissionMode === 'auto') {
        if (isMcpToolName(toolName) || toolName === 'Write' || toolName === 'Edit' || toolName === 'Task') {
            decision = 'deny';
            reason = 'Auto mode blocks this tool.';
        }
        else if (toolName === 'Bash') {
            const cmd = toolInputCommand(toolName, toolInput);
            decision = cmd && isAutoReadOnlyBash(cmd) ? 'allow' : 'deny';
            reason = decision === 'allow'
                ? 'Auto mode allows only a small allowlist of read-only shell commands.'
                : 'Auto mode blocks this shell command.';
        }
        else if (toolName === 'WebFetch') {
            const host = toolInputDomain(toolName, toolInput);
            if (!host)
                decision = 'deny';
            else if (isLoopbackHost(host))
                decision = 'deny';
            else if (isIpLiteral(host) && isPrivateOrLinkLocalIp(host))
                decision = 'deny';
            else
                decision = isPreapprovedHost(host) ? 'allow' : 'deny';
            if (decision === 'deny')
                reason = 'Auto mode blocks WebFetch unless the hostname is preapproved and not local/private.';
        }
        else {
            decision = 'allow';
            reason = 'Auto mode allows this tool.';
        }
    }
    const absPath = toolInputPath(toolName, toolInput, cwd);
    const cmd = toolInputCommand(toolName, toolInput);
    const host = toolInputDomain(toolName, toolInput);
    const toolLower = toolName.toLowerCase();
    for (const rule of rules) {
        if (!rule || !rule.effect)
            continue;
        if (rule.tool) {
            const rTool = String(rule.tool).toLowerCase();
            if (!matchPattern(rTool, toolLower))
                continue;
        }
        if (rule.path) {
            if (!absPath)
                continue;
            const patt = normalizeForMatch(String(rule.path));
            const rel = normalizeForMatch(path.relative(cwd, absPath));
            const relOk = rel && rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\');
            if (!matchPattern(patt, absPath) && !(relOk && matchPattern(patt, rel))) {
                continue;
            }
        }
        if (rule.domain) {
            if (!host)
                continue;
            if (!matchPattern(String(rule.domain), host))
                continue;
        }
        if (rule.command) {
            if (!cmd)
                continue;
            if (!matchPattern(String(rule.command), cmd))
                continue;
        }
        if (rule.effect === 'allow')
            decision = 'allow';
        else if (rule.effect === 'deny')
            decision = 'deny';
        else
            decision = 'ask';
        matchedRule = rule;
    }
    if (matchedRule) {
        const parts = [
            matchedRule.tool ? `tool=${matchedRule.tool}` : null,
            matchedRule.path ? `path=${matchedRule.path}` : null,
            matchedRule.domain ? `domain=${matchedRule.domain}` : null,
            matchedRule.command ? `command=${matchedRule.command}` : null,
        ].filter(Boolean);
        reason = matchedRule.description
            ? `Matched rule (${matchedRule.effect}): ${matchedRule.description}`
            : `Matched rule (${matchedRule.effect}): ${parts.join(' ')}`;
    }
    if (permissionMode === 'auto' && decision === 'ask') {
        return { decision: 'deny', reason: reason ?? 'Auto mode converts ask into deny.', rule: matchedRule };
    }
    return { decision, reason, rule: matchedRule };
}
function isIpLiteral(hostname) {
    const h = (hostname ?? '').toLowerCase();
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h))
        return true;
    if (h.includes(':'))
        return true;
    return false;
}
