import { randomUUID } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { assertSafeLocalPath, resolveRealPathWithinCwd } from './pathSafety.js';
function pmDir(cwd) {
    return path.join(cwd, '.guang', 'pm');
}
function ledgerPath(cwd) {
    return path.join(pmDir(cwd), 'decisions.json');
}
export async function loadDecisionLedger(cwd) {
    try {
        const raw = await readFile(ledgerPath(cwd), 'utf-8');
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.decisions)) {
            return { version: 1, updatedAt: 0, decisions: [] };
        }
        return parsed;
    }
    catch {
        return { version: 1, updatedAt: 0, decisions: [] };
    }
}
async function saveDecisionLedger(cwd, ledger) {
    await mkdir(pmDir(cwd), { recursive: true });
    await writeFile(ledgerPath(cwd), JSON.stringify(ledger, null, 2), 'utf-8');
}
export async function addDecision(cwd, input) {
    const now = Date.now();
    const ledger = await loadDecisionLedger(cwd);
    const d = {
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
        title: input.title,
        summary: input.summary,
        rationale: input.rationale,
        alternatives: input.alternatives,
        owner: input.owner,
        due: input.due,
        links: input.links,
        source: input.source,
    };
    ledger.decisions.push(d);
    ledger.updatedAt = now;
    await saveDecisionLedger(cwd, ledger);
    return d;
}
export async function linkDecision(cwd, idPrefix, link) {
    const ledger = await loadDecisionLedger(cwd);
    const d = ledger.decisions.find(x => x.id.startsWith(idPrefix) || x.id.slice(0, 8) === idPrefix);
    if (!d)
        return null;
    const links = new Set([...(d.links ?? []), link]);
    d.links = Array.from(links.values());
    d.updatedAt = Date.now();
    ledger.updatedAt = d.updatedAt;
    await saveDecisionLedger(cwd, ledger);
    return d;
}
export function renderDecisionList(ledger, limit = 20) {
    const items = ledger.decisions.slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
    if (items.length === 0)
        return 'No decisions recorded.';
    const lines = items.map((d, i) => {
        const owner = d.owner ? `  owner:${d.owner}` : '';
        const due = d.due ? `  due:${d.due}` : '';
        return `${i + 1}. ${d.id.slice(0, 8)}  ${d.title}${owner}${due}`;
    });
    return `Decisions:\n${lines.join('\n')}`;
}
export function renderDecisionForPrompt(ledger, maxChars = 20000) {
    const items = ledger.decisions.slice().sort((a, b) => b.updatedAt - a.updatedAt);
    const out = [];
    let used = 0;
    for (const d of items) {
        const block = [
            `- id: ${d.id}`,
            `  title: ${d.title}`,
            `  summary: ${d.summary}`,
            d.rationale ? `  rationale: ${d.rationale}` : null,
            d.owner ? `  owner: ${d.owner}` : null,
            d.due ? `  due: ${d.due}` : null,
            d.links?.length ? `  links: ${d.links.join(', ')}` : null,
        ].filter(Boolean).join('\n') + '\n';
        if (used + block.length > maxChars)
            break;
        out.push(block);
        used += block.length;
    }
    return out.length ? out.join('\n') : '[No decisions]';
}
export async function exportDecisionLedgerMarkdown(cwd, outPath) {
    const abs = assertSafeLocalPath({ cwd, inputPath: outPath });
    await resolveRealPathWithinCwd({ cwd, absPath: abs });
    const ledger = await loadDecisionLedger(cwd);
    const items = ledger.decisions.slice().sort((a, b) => b.updatedAt - a.updatedAt);
    const lines = ['# Decision Ledger', ''];
    for (const d of items) {
        lines.push(`## ${d.title}`);
        lines.push('');
        lines.push(`- id: ${d.id}`);
        if (d.owner)
            lines.push(`- owner: ${d.owner}`);
        if (d.due)
            lines.push(`- due: ${d.due}`);
        lines.push(`- updated: ${new Date(d.updatedAt).toISOString()}`);
        lines.push('');
        lines.push(d.summary);
        lines.push('');
        if (d.rationale) {
            lines.push('### Rationale');
            lines.push(d.rationale);
            lines.push('');
        }
        if (d.alternatives?.length) {
            lines.push('### Alternatives');
            for (const a of d.alternatives)
                lines.push(`- ${a}`);
            lines.push('');
        }
        if (d.links?.length) {
            lines.push('### Links');
            for (const l of d.links)
                lines.push(`- ${l}`);
            lines.push('');
        }
    }
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, lines.join('\n'), 'utf-8');
    return abs;
}
