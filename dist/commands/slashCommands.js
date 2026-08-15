// ============================================================
//  Guang Code — Slash Commands
// ============================================================
import { getTools } from '../tools/index.js';
import { AgentTool } from '../tools/AgentTool.js';
import { listSessions, loadSession, saveSession } from '../utils/sessionStorage.js';
import { sessionStore, SESSION_EVENT_TYPES } from '../utils/sessionES.js';
import { skills as skillLoader } from '../utils/skillLoader.js';
import { defaultToolPipeline } from '../utils/toolPipeline.js';
import { setProviderKey, setDefaultModel, setDefaultMode, loadConfig, setOutputStyle, setMemoryDirectory, setMemoryEnabled, addPermissionRule, removePermissionRule, clearPermissionRules, setTrustedProjectConfig } from '../utils/config.js';
import { compactionRegistry, COMPACTION_STRATEGIES } from '../utils/compaction.js';
import { pluginManager, APPROVAL_MODELS } from '../utils/pluginManager.js';
import { createSdkServer, createSdkClient, SDK_PACKAGE_INFO, buildToolsSchema } from '../utils/sdkInterop.js';
import { KNOWN_MODELS } from '../providers/index.js';
import { loadCustomCommands } from '../utils/customCommands.js';
import { isGitRepo, getGitStatus, getGitDiff, getCurrentBranch } from '../utils/git.js';
import { subagentTasks } from '../utils/subagentTasks.js';
import { randomUUID } from 'crypto';
import { loadAllSkills, renderSkillInvocation } from '../utils/skills.js';
import { homedir } from 'os';
import { addMemory, ensureMemoryIndexExists, getProjectMemoryDir, listMemoryEntries, readMemoryFile, removeMemory } from '../utils/memdir.js';
import { memory as memoryRegistry, DEFAULT_MEMORY_CONFIG, getMemoryConfigFromGcConfig } from '../utils/memoryRegistry.js';
import { addProjectCronTask, clearProjectCronTasks, listProjectCronTasks, removeProjectCronTask, setProjectCronTaskEnabled } from '../utils/cronTasks.js';
import { parseCronExpression } from '../utils/cron.js';
import { mkdir, writeFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { clearPmContext, ingestPmFiles, loadPmContext, renderPmContextForPrompt } from '../utils/pmContext.js';
import { addDecision, exportDecisionLedgerMarkdown, linkDecision, loadDecisionLedger, renderDecisionForPrompt, renderDecisionList } from '../utils/decisionLedger.js';
import { startWebServer, stopWebServer, getWebServer } from '../utils/webServer.js';
// ── /help ─────────────────────────────────────────────────────────────────────
const helpCommand = {
    name: 'help',
    description: 'Show available commands and keyboard shortcuts',
    usage: '/help',
    noArgs: true,
    async execute(_args, state, _setState) {
        const tools = getTools();
        const toolList = tools.map(t => `  • ${t.name.padEnd(14)} ${t.description.slice(0, 56)}`).join('\n');
        const allCommands = getAllSlashCommands(state.cwd);
        const customCommands = allCommands.filter(c => !builtInSlashCommands.some(bc => bc.name === c.name));
        let customCommandsSection = '';
        if (customCommands.length > 0) {
            const customList = customCommands.map(c => `  /${c.name.padEnd(18)} ${c.description.slice(0, 56)}`).join('\n');
            customCommandsSection = `\nCUSTOM COMMANDS:\n${customList}\n`;
        }
        return `
╔══════════════════════════════════════════════════════════╗
║                   Guang Code — Help                      ║
╚══════════════════════════════════════════════════════════╝

SLASH COMMANDS:
  /help               Show this help
  /clear              Clear conversation history
  /cost               Show token usage and cost estimate
  /model [name]       Switch AI model (shows list if no arg)
  /providers          List all supported models & providers
  /keys <id> <key>    Set an API key (saves to ~/.guang-code/config.json)
  /mode <mode>        Switch permission mode (default/auto/plan)
  /plan ...           Plan workflow (start/show/approve/reset)
  /style [name]       Switch output style (default/explanatory/learning)
  /permissions ...    Manage fine-grained permission rules
  /skills             List available skills
  /skill <id> [args]  Execute a skill (prompt template)
  /memory ...         Manage persistent project memory
  /cron ...           Manage scheduled tasks (project)
  /compact            Summarize and compress conversation history
  /align ...          Ingest/scan files for alignment
  /decision ...       Decision ledger tools
  /impact ...         Change impact analysis
  /pack ...           Generate an alignment pack
  /sessions           List recent sessions
  /resume <id>        Resume a session in-place
  /session ...        Session tools (new/rename/export)
  /template ...       Templates (prd/story/release/competitor)
  /trust ...          Manage project trust (mcp/hooks)
  /tasks              List background sub-agent tasks
  /task-cancel <id>   Cancel a running task
  /task-retry <id>    Retry a failed task (spawns a new one)
  /send <id> <msg>    Send a follow-up message to a running task
  /exit               Exit Guang Code
${customCommandsSection}
KEYBOARD SHORTCUTS:
  Enter               Send message
  Ctrl+P              Command palette
  Tab                 Slash autocomplete (when input starts with "/")
  Ctrl+C              Cancel current request
  Ctrl+D              Exit
  ↑ / ↓              Browse message history

AVAILABLE TOOLS:
${toolList}

PERMISSION MODES:
  default  Ask before running bash commands and file writes
  auto     Execute all tools without asking (use with care!)
  plan     Read-only mode — get a plan approved before writing

TIPS:
  • Run /keys anthropic sk-ant-... to save your Anthropic key
  • Run /keys openai sk-... to save your OpenAI key
  • Run /keys minimax <key> to save your MiniMax key
  • Use /model gpt-4o to switch to GPT-4o mid-session
    `.trim();
    },
};
// ── /tasks ────────────────────────────────────────────────────────────────────
const tasksCommand = {
    name: 'tasks',
    description: 'List background sub-agent tasks',
    usage: '/tasks',
    noArgs: true,
    async execute(_args, _state, _setState) {
        const tasks = subagentTasks.list().slice(0, 20);
        if (tasks.length === 0)
            return 'No background tasks.';
        const lines = tasks.map(t => {
            const name = t.name ? ` (${t.name})` : '';
            const age = Math.round((Date.now() - t.createdAt) / 1000);
            return `- ${t.id.slice(0, 8)}${name}  ${t.status}  ${age}s  ${t.description}`;
        });
        return `Tasks:\n${lines.join('\n')}`;
    },
};
// ── /task-cancel ──────────────────────────────────────────────────────────────
const taskCancelCommand = {
    name: 'task-cancel',
    description: 'Cancel a running background task: /task-cancel <id|name>',
    async execute(args, _state, _setState) {
        const id = args.trim();
        if (!id)
            return 'Usage: /task-cancel <id|name>';
        const res = subagentTasks.cancel(id);
        if (!res.ok)
            return res.error ?? 'Cancel failed';
        return `Cancelled task: ${id}`;
    },
};
// ── /task-retry ───────────────────────────────────────────────────────────────
const taskRetryCommand = {
    name: 'task-retry',
    description: 'Retry a task by id or name (spawns a new background task)',
    async execute(args, state, _setState) {
        const id = args.trim();
        if (!id)
            return 'Usage: /task-retry <id|name>';
        const task = subagentTasks.get(id);
        if (!task)
            return `Task not found: ${id}`;
        if (task.status === 'running')
            return `Task is still running: ${task.id.slice(0, 8)}`;
        const input = { ...task.params, run_in_background: 'true' };
        const res = await AgentTool.execute(input, {
            cwd: state.cwd,
            permissionMode: state.permissionMode,
            model: state.model,
            providerConfig: state.providerConfig,
            onPermissionRequest: async () => 'deny',
        });
        return res.isError ? `Retry failed: ${res.content}` : `Retry started: ${res.content}`;
    },
};
// ── /send ─────────────────────────────────────────────────────────────────────
const sendCommand = {
    name: 'send',
    description: 'Send a follow-up message to a running task: /send <id|name> <message>',
    async execute(args, _state, _setState) {
        const trimmed = args.trim();
        if (!trimmed)
            return 'Usage: /send <id|name> <message>';
        const firstSpace = trimmed.indexOf(' ');
        if (firstSpace < 0)
            return 'Usage: /send <id|name> <message>';
        const to = trimmed.slice(0, firstSpace).trim();
        const message = trimmed.slice(firstSpace + 1);
        const res = subagentTasks.enqueueMessage(to, message);
        if (!res.ok)
            return res.error ?? 'Send failed';
        return `Sent to ${to}`;
    },
};
// ── /clear ────────────────────────────────────────────────────────────────────
const clearCommand = {
    name: 'clear',
    description: 'Clear conversation history and start fresh',
    usage: '/clear',
    noArgs: true,
    async execute(_args, _state, setState) {
        setState(prev => ({
            ...prev,
            messages: [],
            inputTokens: 0,
            outputTokens: 0,
            error: null,
        }));
        return null;
    },
};
// ── /cost ─────────────────────────────────────────────────────────────────────
const costCommand = {
    name: 'cost',
    description: 'Show current session token usage and cost estimate',
    usage: '/cost',
    noArgs: true,
    async execute(_args, state, _setState) {
        const { inputTokens, outputTokens, model } = state;
        // Build cost table from KNOWN_MODELS
        const costs = {};
        for (const m of KNOWN_MODELS) {
            const match = m.pricing.match(/\$([\d.]+)\/\$([\d.]+)/);
            if (match) {
                costs[m.id] = { input: parseFloat(match[1]), output: parseFloat(match[2]) };
            }
        }
        const modelCost = costs[model] ?? { input: 3.0, output: 15.0 };
        const inputCost = (inputTokens / 1_000_000) * modelCost.input;
        const outputCost = (outputTokens / 1_000_000) * modelCost.output;
        const totalCost = inputCost + outputCost;
        return `
TOKEN USAGE  (model: ${model})
  Input tokens:   ${inputTokens.toLocaleString()}
  Output tokens:  ${outputTokens.toLocaleString()}
  Total tokens:   ${(inputTokens + outputTokens).toLocaleString()}

ESTIMATED COST
  Input:   $${inputCost.toFixed(5)}
  Output:  $${outputCost.toFixed(5)}
  Total:   $${totalCost.toFixed(5)}
    `.trim();
    },
};
// ── /model ────────────────────────────────────────────────────────────────────
const modelCommand = {
    name: 'model',
    description: 'Switch AI model  (e.g. /model gpt-4o)',
    async execute(args, state, setState) {
        const model = args.trim();
        if (!model) {
            // Show compact list grouped by provider
            const byProvider = {};
            for (const m of KNOWN_MODELS) {
                if (!byProvider[m.provider])
                    byProvider[m.provider] = [];
                byProvider[m.provider].push(m);
            }
            const lines = [`Current model: ${state.model}\n`, 'Available models:'];
            for (const [pid, models] of Object.entries(byProvider)) {
                lines.push(`\n  [${pid}]`);
                for (const m of models) {
                    const mark = m.id === state.model ? ' ◀ active' : '';
                    lines.push(`  • ${m.id.padEnd(36)} ${m.contextWindow.padEnd(5)} ${m.pricing}${mark}`);
                }
            }
            lines.push('\nUsage: /model <model-id>');
            return lines.join('\n');
        }
        setState(prev => ({ ...prev, model }));
        // Persist to config
        setDefaultModel(model).catch(() => { });
        const known = KNOWN_MODELS.find(m => m.id === model);
        const extra = known ? `  (${known.displayName}, ${known.provider})` : '';
        return `Model switched to: ${model}${extra}`;
    },
};
// ── /providers ────────────────────────────────────────────────────────────────
const providersCommand = {
    name: 'providers',
    description: 'List all supported providers and their models',
    usage: '/providers',
    noArgs: true,
    async execute(_args, state, _setState) {
        const cfg = await loadConfig();
        // Show which providers have keys configured
        const providerIds = ['anthropic', 'openai', 'minimax', 'openai-compatible'];
        const keyStatus = providerIds.map(pid => {
            const envKey = {
                anthropic: process.env.ANTHROPIC_API_KEY,
                openai: process.env.OPENAI_API_KEY,
                minimax: process.env.MINIMAX_API_KEY,
                'openai-compatible': process.env.GC_API_KEY ?? process.env.OPENAI_API_KEY,
            }[pid];
            const cfgKey = cfg.providers[pid]?.apiKey ?? cfg.providers[pid]?.apiKeyEnc;
            const hasKey = !!(envKey || cfgKey);
            return `  ${hasKey ? '✓' : '✗'} ${pid.padEnd(20)} ${hasKey ? '(key configured)' : '(no key — run /keys ' + pid + ' <KEY>)'}`;
        });
        const byProvider = {};
        for (const m of KNOWN_MODELS) {
            if (!byProvider[m.provider])
                byProvider[m.provider] = [];
            byProvider[m.provider].push(m);
        }
        const modelLines = [];
        for (const [pid, models] of Object.entries(byProvider)) {
            modelLines.push(`\n  [${pid}]`);
            for (const m of models) {
                const mark = m.id === state.model ? ' ◀ active' : '';
                modelLines.push(`  • ${m.id.padEnd(36)} ${m.contextWindow.padEnd(5)} ${m.pricing}${mark}`);
            }
        }
        return [
            'PROVIDER STATUS:',
            ...keyStatus,
            '\nSUPPORTED MODELS:',
            ...modelLines,
            '\nTo add more providers (OpenAI-compatible gateways, e.g. DeepSeek/Qwen/GLM):',
            '  /keys openai-compatible <YOUR_KEY>',
            '  then set GC_BASE_URL in your shell, e.g.:',
            '    DeepSeek: https://api.deepseek.com/v1',
            '    Qwen:     https://dashscope.aliyuncs.com/compatible-mode/v1',
            '    GLM:      https://open.bigmodel.cn/api/paas/v4',
            '  and /model <model-id> (e.g. deepseek-chat / qwen-plus / glm-4)',
        ].join('\n');
    },
};
// ── /keys ─────────────────────────────────────────────────────────────────────
const keysCommand = {
    name: 'keys',
    description: 'Set API key: /keys <provider> <key>  e.g. /keys anthropic sk-ant-...',
    async execute(args, _state, setState) {
        const parts = args.trim().split(/\s+/);
        if (parts.length < 2 || !parts[0] || !parts[1]) {
            return `Usage: /keys <provider> <api-key>

Providers:
  anthropic           (ANTHROPIC_API_KEY)
  openai              (OPENAI_API_KEY)
  minimax             (MINIMAX_API_KEY)
  openai-compatible   (for DeepSeek, Qwen, etc.)

Examples:
  /keys anthropic sk-ant-...
  /keys openai sk-...
  /keys minimax eyJ...
  /keys openai-compatible <KEY>   (also set GC_BASE_URL in shell)

Keys are saved to ~/.guang-code/config.json`;
        }
        const [pid, key] = parts;
        const validProviders = ['anthropic', 'openai', 'minimax', 'openai-compatible'];
        if (!validProviders.includes(pid)) {
            return `Unknown provider "${pid}". Valid: ${validProviders.join(', ')}`;
        }
        await setProviderKey(pid, key);
        // Update in-memory config
        setState(prev => ({
            ...prev,
            providerConfig: {
                ...prev.providerConfig,
                providers: {
                    ...prev.providerConfig.providers,
                    [pid]: { ...prev.providerConfig.providers[pid], apiKey: key },
                },
            },
        }));
        const masked = key.slice(0, 8) + '...' + key.slice(-4);
        return `API key saved for "${pid}": ${masked}\nConfig: ~/.guang-code/config.json`;
    },
};
// ── /mode ─────────────────────────────────────────────────────────────────────
const modeCommand = {
    name: 'mode',
    description: 'Switch permission mode: /mode default | auto | plan',
    async execute(args, _state, setState) {
        const mode = args.trim();
        if (!['default', 'auto', 'plan'].includes(mode)) {
            return `Invalid mode. Choose: default, auto, or plan

  default  Ask before bash commands and file writes
  auto     Execute safe tools without asking (denies unsafe tools)
  plan     Read-only until plan is approved`;
        }
        setState(prev => ({
            ...prev,
            permissionMode: mode,
            planApproved: mode === 'plan' ? false : prev.planApproved,
            pendingPlan: mode === 'plan' ? prev.pendingPlan : undefined,
        }));
        setDefaultMode(mode).catch(() => { });
        return `Permission mode switched to: ${mode}`;
    },
};
// ── /compact ──────────────────────────────────────────────────────────────────
const compactCommand = {
    name: 'compact',
    description: 'Compress conversation history via pluggable strategies (keep_last, summary_inject, summary_llm, hybrid)',
    usage: '/compact [strategy] [--keep=N] [--max-chars=N]',
    examples: [' /compact hybrid', ' /compact summary_inject --keep=12', ' /compact summary_llm'],
    async execute(args, state, setState) {
        const trimmed = args.trim();
        const tokens = trimmed.split(/\s+/).filter(Boolean);
        let strategy = compactionRegistry.defaultName;
        let opts = { keep: undefined, maxChars: undefined };
        for (const t of tokens) {
            const mk = t.match(/^--keep=(\d+)$/);
            if (mk) { opts.keep = Number(mk[1]); continue; }
            const mc = t.match(/^--max-chars=(\d+)$/);
            if (mc) { opts.maxChars = Number(mc[1]); continue; }
            if (COMPACTION_STRATEGIES.includes(t)) { strategy = t; continue; }
            if (t === 'list' || t === '--list' || t === '-l') {
                const rows = compactionRegistry.list().map(s => `- ${s.name.padEnd(18)} llm=${s.capabilities?.canUseLLM ? 'yes' : 'no '}  uses=${s.usage ?? 0}`);
                return `Available compaction strategies (default=${compactionRegistry.defaultName}):\n\n${rows.join('\n')}`;
            }
            if (t === 'set-default') continue; // handled below
        }
        // Allow: /compact set-default <name>
        if (tokens.includes('set-default')) {
            const name = tokens.find(t => COMPACTION_STRATEGIES.includes(t));
            if (!name) return 'Usage: /compact set-default keep_last | summary_inject | summary_llm | hybrid';
            compactionRegistry.setDefault(name);
            return `Default compaction strategy updated to: ${name}`;
        }
        const { messages } = state;
        if (messages.length < 4) return `Conversation too short to compact (messages=${messages.length}).`;
        const run = await compactionRegistry.run({
            messages,
            cwd: state.cwd,
            maxMessages: opts.keep,
            maxChars: opts.maxChars,
            llmSummary: null, // caller can wire via state.llmProvider later
        }, { strategy });
        setState(prev => ({ ...prev, messages: run.messages }));
        return `Compacted via strategy=${run.strategy} (${run.durationMs}ms):\n  dropped=${run.removed}  kept=${run.kept}  — ${run.report}`;
    },
};
// ── /plugin ───────────────────────────────────────────────────────────────────
const pluginCommand = {
    name: 'plugin',
    description: 'Agent self-modify: propose / list / activate / deactivate runtime plugins with approval flows',
    usage: '/plugin list | propose <name> <source> | activate <id> | deactivate <id> | approve <requestId> | deny <requestId> | pending | info <id>',
    examples: [' /plugin list', ' /plugin pending', ' /plugin approve req-uuid', ' /plugin activate my-plugin'],
    async execute(args, state, setState) {
        const [sub, ...rest] = args.trim().split(/\s+/);
        const cmd = (sub || 'list').toLowerCase();
        if (cmd === 'list') {
            const arr = pluginManager.list();
            if (arr.length === 0) return 'No plugins yet. Create one via: /plugin propose <name> <source>';
            return arr.map(p => `- ${p.id.padEnd(26)} v${p.version} by ${p.author}  [${p.approvalModel}] ${p.activated ? '✔ active' : '○ idle'}  digest=${p.digest.slice(0,10)}  ${p.error ? 'ERR: ' + p.error.slice(0, 80) : ''}`).join('\n');
        }
        if (cmd === 'info') {
            const id = rest[0]; if (!id) return 'Usage: /plugin info <id>';
            const p = pluginManager.plugins.get(id);
            if (!p) return `Plugin not found: ${id}`;
            return [
                `id        = ${p.id}`,
                `version   = ${p.version}`,
                `author    = ${p.author}`,
                `approval  = ${p.approvalModel}`,
                `activated = ${p.activated}`,
                `digest    = ${p.digest}`,
                `tags      = ${p.tags.join(',') || '-'}`,
                `requires  = ${p.requires.join(',') || '-'}`,
                `fs-write  = ${p.fsWrite.join(',') || '-'}`,
                `fs-read   = ${p.fsRead.join(',') || '-'}`,
                `activation error = ${p.activationError || '-'}`,
                `logs      = ${(p._activationLogs || []).join('\n             ') || '-'}`,
            ].join('\n');
        }
        if (cmd === 'pending') {
            const p = pluginManager.approval.listPending();
            if (p.length === 0) return 'No pending approvals.';
            return p.map(r => `#${r.id.slice(0,10)}  ${r.pluginId}  need=${r.requiredApproval}  at=${new Date(r.createdAt).toLocaleTimeString()}`).join('\n');
        }
        if (cmd === 'approve' || cmd === 'deny') {
            const reqId = rest[0];
            if (!reqId) return `Usage: /plugin ${cmd} <requestId>`;
            const decision = cmd === 'approve' ? 'approve' : 'deny';
            const by = 'user:interactive';
            try {
                const req = pluginManager.approval.decide(reqId, decision, by);
                // Auto-activate on approve for simple plugins
                if (decision === 'approve') {
                    try { await pluginManager.activate(req.pluginId); } catch (e) { return `Approved ${req.pluginId}, but activation failed: ${e.message}`; }
                }
                return `${decision === 'approve' ? '✔ Approved' : '✖ Denied'}: ${req.pluginId} (request ${reqId.slice(0,10)}…)`;
            } catch (e) { return e.message; }
        }
        if (cmd === 'activate') {
            const id = rest[0]; if (!id) return 'Usage: /plugin activate <id>';
            try { await pluginManager.activate(id); return `✔ Activated plugin: ${id}`; }
            catch (e) { return `Activation failed: ${e.message}`; }
        }
        if (cmd === 'deactivate') {
            const id = rest[0]; if (!id) return 'Usage: /plugin deactivate <id>';
            const ok = pluginManager.deactivate(id);
            return ok ? `Deactivated plugin: ${id}` : `Plugin not active: ${id}`;
        }
        if (cmd === 'models') { return `Available approval models: ${APPROVAL_MODELS.join(', ')}`; }
        if (cmd === 'propose') {
            const id = rest[0];
            const source = rest.slice(1).join(' ');
            if (!id || !source.trim()) return 'Usage: /plugin propose <id> <comment-frontmatter source with activate function>';
            const out = await pluginManager.propose(source, { id });
            const extra = out.pending
                ? `Approval required (${out.plugin.approvalModel}). Run:   /plugin approve ${out.approvalId.slice(0,10)}…`
                : 'Auto-approved (approval=none). Placing activation via /plugin activate recommended.';
            return `Proposed plugin ${out.plugin.id} v${out.plugin.version} digest=${out.plugin.digest.slice(0,12)}\n${extra}`;
        }
        return [
            'Plugin commands:',
            '  /plugin list                — list all proposed plugins',
            '  /plugin propose <id> <src>  — propose plugin source (approval auto-requested)',
            '  /plugin activate <id>       — load & activate a plugin',
            '  /plugin deactivate <id>     — deactivate plugin, unregister tools/hooks',
            '  /plugin pending             — show open approval requests',
            '  /plugin approve <requestId> — approve pending request',
            '  /plugin deny <requestId>    — deny pending request',
            '  /plugin info <id>           — details, activation logs, digests',
            '  /plugin models              — show 4 approval models',
        ].join('\n');
    },
};
// ── /sdk ──────────────────────────────────────────────────────────────────────
const sdkCommand = {
    name: 'sdk',
    description: 'Inspect/start the MCP/ACP/JSON-RPC interop SDK. Also tests a local server round-trip.',
    usage: '/sdk info | tools | ping [jsonrpc|acp|mcp] | start-server | subscribe <topic> | publish <topic> <json>',
    examples: [' /sdk info', ' /sdk ping mcp', ' /sdk tools', ' /sdk subscribe memory'],
    async execute(args, state, _setState) {
        const [sub, ...rest] = args.trim().split(/\s+/);
        const cmd = (sub || 'info').toLowerCase();
        // Shared SDK server singleton
        const server = _sdkServer(state);
        if (cmd === 'info') {
            const info = await server.handleRawHttp(JSON.stringify({ jsonrpc: '2.0', method: 'sdk.info', id: 1 }));
            const i = info[0]?.result ?? {};
            return [
                `SDK: ${SDK_PACKAGE_INFO.name} v${SDK_PACKAGE_INFO.version}`,
                `  protocols     = ${i.protocols.join(', ')}`,
                `  capabilities  = ${JSON.stringify(i.capabilities)}`,
                `  endpoints     = ${JSON.stringify(i.endpoints)}`,
                '',
                'Integrate from any external program using:',
                `  HTTP POST     → ${i.endpoints.httpPost}   body: { jsonrpc:"2.0", id:1, method:"tools/list" }`,
                `  NDJSON stream → ${i.endpoints.ndjson}     chunked request + streaming response`,
                `  SSE (push)    → ${i.endpoints.sse}        for ACP pub/sub`,
            ].join('\n');
        }
        if (cmd === 'tools') {
            const resp = await server.handleRawHttp(JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }));
            const sch = resp[0]?.result ?? {};
            return `Registered tools (${sch.toolCount}):\n` + (sch.tools ?? []).slice(0, 30).map(t => `- ${t.name.padEnd(22)}  ${t.description?.slice(0, 80) || ''}`).join('\n');
        }
        if (cmd === 'ping') {
            const proto = rest[0] ?? 'jsonrpc';
            const protocol = ['jsonrpc','acp','mcp'].includes(proto) ? proto : 'jsonrpc';
            const { InProcessServerTransport } = await import('../utils/sdkInterop.js');
            const tp = new InProcessServerTransport();
            server.attachTransport(tp, protocol);
            const out = []; tp.on('out', (m) => out.push(m));
            if (protocol === 'mcp') {
                tp.inject({ jsonrpc: '2.0', id: 10, method: 'initialize', params: { protocolVersion: '2024-11-05', clientInfo: { name: 'cli', version: '0' } } });
                tp.inject({ jsonrpc: '2.0', method: 'notifications/initialized' });
            } else if (protocol === 'acp') {
                tp.inject({ jsonrpc: '2.0', id: 10, method: 'acp.subscribe', params: { topic: 'session.*' } });
                tp.inject({ jsonrpc: '2.0', id: 11, method: 'session/schema' });
            } else {
                tp.inject({ jsonrpc: '2.0', id: 10, method: 'memory/schema' });
                tp.inject({ jsonrpc: '2.0', id: 11, method: 'session/schema' });
                tp.inject({ jsonrpc: '2.0', id: 12, method: 'sdk.info' });
            }
            await new Promise(r => setTimeout(r, 20));
            return `Ping (protocol=${protocol}) got ${out.length} responses:\n` + out.map(o => `  id=${o.id ?? 'notif'} method=${o.method ?? '-'} ok=${!!o.result}`).join('\n');
        }
        if (cmd === 'subscribe') {
            const topic = rest[0]; if (!topic) return 'Usage: /sdk subscribe <topic>';
            const r = await server.handleRawHttp(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'acp.subscribe', params: { topic } }));
            const resp = r[0]?.result ?? {};
            return `Subscribed (in-process): ${JSON.stringify(resp)}`;
        }
        if (cmd === 'publish') {
            const topic = rest[0]; const payload = rest.slice(1).join(' ');
            if (!topic) return 'Usage: /sdk publish <topic> <text-or-json>';
            const parsed = (() => { try { return JSON.parse(payload); } catch { return { text: payload }; } })();
            const sent = server.publish(topic, parsed);
            return `Published to topic="${topic}" (in-process subscribers notified=${sent}).`;
        }
        return [
            'SDK commands:',
            '  /sdk info                 — sdk package info + endpoints',
            '  /sdk tools                — registered tools & schemas (tools/list)',
            '  /sdk ping [jsonrpc|acp|mcp] — in-process round trip smoke',
            '  /sdk subscribe <topic>    — subscribe server to ACP topic (in-process for now)',
            '  /sdk publish <topic> <payload> — publish server-side ACP event',
        ].join('\n');
    },
};
// Internal singleton for sdk command
let __sdkServer = null;
function _sdkServer(state) {
    if (__sdkServer) return __sdkServer;
    __sdkServer = createSdkServer({
        getTools: () => {
            try {
                // Try import existing tool registry
                const { allTools } = require('../tools/index.js');
                if (Array.isArray(allTools)) return allTools;
            } catch {}
            // Fallback: stub tools for smoke-testing SDK endpoints
            return [
                { name: 'noop', description: 'No-op test tool', inputSchema: { type: 'object', properties: { value: { type: 'string' } } }, execute: async (i) => ({ content: JSON.stringify(i ?? {}) }) },
            ];
        },
        memoryBackend: {
            backendName: 'hybrid',
            capabilities: { add: true, remove: true, search: true, list: true },
            listEntries: (q) => { try { return (state.memory || {}).listEntries?.(q) ?? []; } catch { return []; } },
            addEntry: (e) => ({ ok: true, id: e?.id ?? 'fake' }),
            searchEntries: (query, q) => [],
        },
        session: sessionStore,
        skills: skillLoader,
        plugins: pluginManager,
    });
    return __sdkServer;
}
// ── /sessions ─────────────────────────────────────────────────────────────────
const sessionsCommand = {
    name: 'sessions',
    description: 'List recent sessions',
    usage: '/sessions',
    noArgs: true,
    async execute(_args, _state, _setState) {
        const sessions = await listSessions();
        if (sessions.length === 0)
            return 'No saved sessions found.';
        const lines = sessions.slice(0, 10).map((s, i) => {
            const date = new Date(s.updatedAt).toLocaleString();
            const tokens = s.inputTokens + s.outputTokens;
            const msgs = s.messages.filter(m => m.role !== 'system').length;
            const title = s.title ? `  ${s.title}` : '';
            return `  ${i + 1}. ${s.id.slice(0, 8)}  ${date}  ${msgs} msgs  ${tokens.toLocaleString()} tokens${title}\n     ${s.cwd}  (${s.model})`;
        });
        return `Recent sessions (resume with: guang -r <number|idPrefix|fullId> or /resume ...):\n\n${lines.join('\n')}`;
    },
};
// ── /resume ───────────────────────────────────────────────────────────────────
const resumeCommand = {
    name: 'resume',
    description: 'Resume a saved session in-place: /resume <number|idPrefix|fullId>',
    usage: '/resume <number|idPrefix|fullId>',
    examples: [' /resume 1', ' /resume abcd1234'],
    async execute(args, _state, setState) {
        const raw = args.trim();
        const sessions = await listSessions();
        if (!raw) {
            const lines = sessions.slice(0, 10).map((s, i) => {
                const title = s.title ? `  ${s.title}` : '';
                return `  ${i + 1}. ${s.id.slice(0, 8)}${title}\n     ${s.cwd}  (${s.model})`;
            });
            return `Usage: /resume <number|idPrefix|fullId>\n\n${lines.join('\n')}`;
        }
        let targetId = raw;
        if (/^\d+$/.test(raw)) {
            const idx = Number(raw);
            const s = Number.isFinite(idx) ? sessions[idx - 1] : undefined;
            targetId = s?.id ?? null;
        }
        else if (!/^[0-9a-fA-F-]{32,}$/.test(raw) || raw.length < 32) {
            const pref = raw.toLowerCase();
            const s = sessions.find(x => x.id.toLowerCase().startsWith(pref));
            targetId = s?.id ?? null;
        }
        const saved = targetId ? await loadSession(targetId) : null;
        if (!saved)
            return `Session not found: ${raw}`;
        setState(prev => ({
            ...prev,
            sessionId: saved.id,
            sessionCreatedAt: saved.createdAt,
            sessionTitle: saved.title,
            messages: saved.messages,
            inputTokens: saved.inputTokens,
            outputTokens: saved.outputTokens,
            model: saved.model,
            cwd: saved.cwd,
            planApproved: false,
            pendingPlan: undefined,
            error: null,
        }));
        return `Resumed session: ${saved.id.slice(0, 8)}  ${saved.title ?? ''}`.trim();
    },
};
// ── /plan ─────────────────────────────────────────────────────────────────────
const planCommand = {
    name: 'plan',
    description: 'Plan workflow: /plan start|show|approve|reset|status',
    usage: '/plan start|show|approve|reset|status',
    examples: [' /plan start', ' /plan show', ' /plan approve'],
    async execute(args, state, setState) {
        const trimmed = args.trim();
        const [sub] = trimmed.split(/\s+/);
        const cmd = (sub || 'status').toLowerCase();
        if (cmd === 'start') {
            setState(prev => ({ ...prev, permissionMode: 'plan', planApproved: false, pendingPlan: undefined }));
            return 'Plan mode started. Ask your request; review with /plan show; approve with /plan approve.';
        }
        if (cmd === 'show') {
            return state.pendingPlan ? state.pendingPlan : 'No pending plan captured yet.';
        }
        if (cmd === 'approve') {
            if (state.permissionMode !== 'plan') {
                return 'Not in plan mode. Use: /plan start';
            }
            setState(prev => ({ ...prev, planApproved: true }));
            return 'Plan approved. Tool execution is now allowed under normal permission prompts.';
        }
        if (cmd === 'reset') {
            setState(prev => ({ ...prev, planApproved: false, pendingPlan: undefined }));
            return 'Plan reset.';
        }
        if (cmd === 'status') {
            const mode = state.permissionMode;
            const approved = state.planApproved ? 'approved' : 'not approved';
            const hasPlan = state.pendingPlan ? 'yes' : 'no';
            return `Plan status:\n- mode: ${mode}\n- approved: ${approved}\n- pending plan: ${hasPlan}`;
        }
        return 'Usage: /plan start|show|approve|reset|status';
    },
};
function renderTemplate(name, rawArgs) {
    const n = (name ?? '').toLowerCase();
    const topic = rawArgs.trim();
    const header = topic ? `# ${topic}\n\n` : '';
    if (n === 'prd') {
        return header + [
            '## 背景',
            '- 问题/机会：',
            '- 目标：',
            '',
            '## 用户与场景',
            '- 目标用户：',
            '- 典型场景：',
            '',
            '## 方案',
            '- 核心流程：',
            '- 交互稿/原型链接：',
            '',
            '## 需求拆解',
            '- Must-have：',
            '- Nice-to-have：',
            '',
            '## 数据与指标',
            '- 指标定义：',
            '- 目标值：',
            '',
            '## 风险与边界',
            '- 风险：',
            '- 不做什么：',
            '',
            '## 里程碑',
            '- 设计：',
            '- 开发：',
            '- 验收/发布：',
        ].join('\n');
    }
    if (n === 'user-story' || n === 'story') {
        return header + [
            '## User Story',
            '- As a ...',
            '- I want ...',
            '- So that ...',
            '',
            '## Acceptance Criteria',
            '- Given ... When ... Then ...',
            '- Given ... When ... Then ...',
            '',
            '## Notes',
            '- 约束：',
            '- 埋点：',
            '- 依赖：',
        ].join('\n');
    }
    if (n === 'release-note' || n === 'release') {
        return header + [
            '## Highlights',
            '- ',
            '',
            '## What’s New',
            '- ',
            '',
            '## Improvements',
            '- ',
            '',
            '## Fixes',
            '- ',
            '',
            '## Known Issues',
            '- ',
            '',
            '## Rollout',
            '- 灰度范围：',
            '- 回滚方案：',
        ].join('\n');
    }
    if (n === 'competitor' || n === 'compete') {
        return header + [
            '## 竞品概览',
            '- 产品名称：',
            '- 目标人群：',
            '- 定价：',
            '',
            '## 核心能力对比',
            '| 维度 | 竞品 | 我们 | 结论 |',
            '| --- | --- | --- | --- |',
            '| | | | |',
            '',
            '## 体验走查',
            '- 关键路径：',
            '- 亮点：',
            '- 痛点：',
            '',
            '## 机会点',
            '- 短期：',
            '- 中期：',
            '- 长期：',
        ].join('\n');
    }
    return null;
}
// ── /template ─────────────────────────────────────────────────────────────────
const templateCommand = {
    name: 'template',
    description: 'Templates: /template list | /template <name> [topic] | /template save <name> <file> [topic]',
    usage: '/template list | /template <name> [topic] | /template save <name> <file> [topic]',
    examples: [' /template prd 新功能名称', ' /template save prd ./PRD.md 新功能名称'],
    async execute(args, state, _setState) {
        const trimmed = args.trim();
        const [a, b, ...rest] = trimmed.split(/\s+/);
        const cmd = (a || 'list').toLowerCase();
        if (cmd === 'list') {
            return [
                'Templates:',
                '- prd [topic]',
                '- user-story|story [topic]',
                '- release-note|release [topic]',
                '- competitor [topic]',
                '',
                'Usage:',
                '  /template prd 新功能名称',
                '  /template save prd ./PRD.md 新功能名称',
            ].join('\n');
        }
        if (cmd === 'save') {
            const name = (b || '').trim();
            const file = (rest[0] || '').trim();
            const topic = rest.slice(1).join(' ');
            if (!name || !file)
                return 'Usage: /template save <name> <file> [topic]';
            const content = renderTemplate(name, topic);
            if (!content)
                return `Unknown template: ${name}. Use: /template list`;
            const abs = resolve(state.cwd, file);
            await mkdir(dirname(abs), { recursive: true });
            await writeFile(abs, content, 'utf-8');
            return `Template saved: ${abs}`;
        }
        const content = renderTemplate(cmd, [b, ...rest].join(' '));
        if (!content)
            return `Unknown template: ${cmd}. Use: /template list`;
        return content;
    },
};
// ── /align ────────────────────────────────────────────────────────────────────
const alignCommand = {
    name: 'align',
    description: 'Ingest/scan files for PM alignment: /align scan|add|list|show|clear',
    usage: '/align scan|add|list|show|clear',
    examples: [' /align scan', ' /align add README.md docs/**/*.md product/**/*.md', ' /align list'],
    async execute(args, state, _setState) {
        const trimmed = args.trim();
        const [sub, ...rest] = trimmed.split(/\s+/);
        const cmd = (sub || 'list').toLowerCase();
        if (cmd === 'list') {
            const ctx = await loadPmContext(state.cwd);
            if (ctx.files.length === 0)
                return 'No ingested files. Use: /align scan or /align add <glob>';
            const lines = ctx.files.slice(0, 30).map((f, i) => `  ${i + 1}. ${f.path}  (${Math.round(f.size / 1024)}KB)`);
            const more = ctx.files.length > 30 ? `\n  … (${ctx.files.length - 30} more)` : '';
            return `Aligned files:\n${lines.join('\n')}${more}`;
        }
        if (cmd === 'clear') {
            await clearPmContext(state.cwd);
            return 'Alignment context cleared.';
        }
        if (cmd === 'scan') {
            const patterns = [
                'README.md',
                'docs/**/*.{md,txt}',
                'product/**/*.{md,txt}',
                'design/**/*.{md,txt}',
                '*.{md,txt}',
            ];
            const res = await ingestPmFiles({ cwd: state.cwd, patternsOrPaths: patterns, maxFiles: 50 });
            return `Scan complete. added=${res.added} skipped=${res.skipped} total=${res.total}`;
        }
        if (cmd === 'add') {
            if (rest.length === 0)
                return 'Usage: /align add <globOrPath> [more...]';
            const items = rest.flatMap(t => t.split(',')).map(s => s.trim()).filter(Boolean);
            const res = await ingestPmFiles({ cwd: state.cwd, patternsOrPaths: items, maxFiles: 100 });
            return `Ingest complete. added=${res.added} skipped=${res.skipped} total=${res.total}`;
        }
        if (cmd === 'show') {
            const key = rest.join(' ').trim();
            if (!key)
                return 'Usage: /align show <number|path>';
            const ctx = await loadPmContext(state.cwd);
            let f = null;
            if (/^\d+$/.test(key)) {
                const idx = Number(key);
                f = Number.isFinite(idx) ? ctx.files[idx - 1] : null;
            }
            else {
                const k = key.replace(/\\/g, '/');
                f = ctx.files.find(x => x.path === k) ?? null;
            }
            if (!f)
                return `Not found: ${key}`;
            return `[FILE] ${f.path}\n\n${f.excerpt}`;
        }
        return 'Usage: /align scan|add|list|show|clear';
    },
};
// ── /decision ─────────────────────────────────────────────────────────────────
const decisionCommand = {
    name: 'decision',
    description: 'Decision ledger: /decision add|list|show|link|export',
    usage: '/decision add|list|show|link|export|extract',
    examples: [' /decision add 定价策略 :: 采用按席位计费', ' /decision list', ' /decision export ./DECISIONS.md', ' /decision extract'],
    async execute(args, state, setState) {
        const trimmed = args.trim();
        const [sub, ...rest] = trimmed.split(/\s+/);
        const cmd = (sub || 'list').toLowerCase();
        if (cmd === 'list') {
            const ledger = await loadDecisionLedger(state.cwd);
            return renderDecisionList(ledger, 30);
        }
        if (cmd === 'add') {
            const raw = rest.join(' ').trim();
            if (!raw)
                return 'Usage: /decision add <title> :: <summary>  (or :: {json})';
            const parts = raw.split('::');
            const title = (parts[0] ?? '').trim();
            const tail = (parts.slice(1).join('::') ?? '').trim();
            if (!title || !tail)
                return 'Usage: /decision add <title> :: <summary>  (or :: {json})';
            let payload = null;
            if (tail.startsWith('{')) {
                try {
                    payload = JSON.parse(tail);
                }
                catch {
                    payload = null;
                }
            }
            const summary = payload?.summary ? String(payload.summary) : tail;
            const d = await addDecision(state.cwd, {
                title,
                summary,
                rationale: payload?.rationale ? String(payload.rationale) : undefined,
                owner: payload?.owner ? String(payload.owner) : undefined,
                due: payload?.due ? String(payload.due) : undefined,
                alternatives: Array.isArray(payload?.alternatives) ? payload.alternatives.map(String) : undefined,
                links: Array.isArray(payload?.links) ? payload.links.map(String) : undefined,
                source: { sessionId: state.sessionId },
            });
            return `Decision recorded: ${d.id.slice(0, 8)}  ${d.title}`;
        }
        if (cmd === 'show') {
            const key = rest.join(' ').trim();
            if (!key)
                return 'Usage: /decision show <number|idPrefix>';
            const ledger = await loadDecisionLedger(state.cwd);
            const items = ledger.decisions.slice().sort((a, b) => b.updatedAt - a.updatedAt);
            let d = null;
            if (/^\d+$/.test(key)) {
                const idx = Number(key);
                d = Number.isFinite(idx) ? items[idx - 1] : null;
            }
            else {
                d = items.find(x => x.id.startsWith(key) || x.id.slice(0, 8) === key) ?? null;
            }
            if (!d)
                return `Not found: ${key}`;
            const lines = [
                `id: ${d.id}`,
                `title: ${d.title}`,
                d.owner ? `owner: ${d.owner}` : null,
                d.due ? `due: ${d.due}` : null,
                `updated: ${new Date(d.updatedAt).toLocaleString()}`,
                '',
                d.summary,
                d.rationale ? `\nRationale:\n${d.rationale}` : null,
                d.alternatives?.length ? `\nAlternatives:\n- ${d.alternatives.join('\n- ')}` : null,
                d.links?.length ? `\nLinks:\n- ${d.links.join('\n- ')}` : null,
            ].filter(Boolean);
            return lines.join('\n');
        }
        if (cmd === 'link') {
            const [id, ...rest2] = rest;
            const link = rest2.join(' ').trim();
            if (!id || !link)
                return 'Usage: /decision link <idPrefix> <link>';
            const d = await linkDecision(state.cwd, id, link);
            if (!d)
                return `Not found: ${id}`;
            return `Linked: ${d.id.slice(0, 8)}  (+1 link)`;
        }
        if (cmd === 'export') {
            const file = rest.join(' ').trim() || './DECISIONS.md';
            const abs = await exportDecisionLedgerMarkdown(state.cwd, file);
            return `Decision ledger exported: ${abs}`;
        }
        if (cmd === 'extract') {
            const ledger = await loadDecisionLedger(state.cwd);
            const ctx = await loadPmContext(state.cwd);
            const prompt = [
                'You are a PM assistant. Extract new or updated decisions from the conversation and the files.',
                'Return a concise list of decisions the team should record in a decision ledger.',
                '',
                'Format:',
                '- Provide a numbered list of decisions.',
                '- For each: Title, Summary, Rationale (optional), Owner (optional), Due (optional), Links (optional).',
                '',
                'Existing decisions:',
                renderDecisionForPrompt(ledger),
                '',
                'Aligned files:',
                renderPmContextForPrompt(ctx),
                '',
                'Conversation (most recent messages):',
                state.messages
                    .filter(m => (m.role === 'user' || m.role === 'assistant') && !m.toolUseId)
                    .slice(-30)
                    .map(m => `${m.role.toUpperCase()}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`)
                    .join('\n\n'),
            ].join('\n');
            setState(prev => ({ ...prev, pendingAutomatedPrompt: { label: 'Decision Extract', prompt } }));
            return 'Extracting decisions…';
        }
        return 'Usage: /decision add|list|show|link|export|extract';
    },
};
// ── /impact ───────────────────────────────────────────────────────────────────
const impactCommand = {
    name: 'impact',
    description: 'Change impact analysis: /impact <change description>',
    usage: '/impact <change description>',
    examples: [' /impact 把「开关默认开」改成默认关，并增加灰度开关'],
    async execute(args, state, setState) {
        const change = args.trim();
        if (!change)
            return 'Usage: /impact <change description>';
        const ledger = await loadDecisionLedger(state.cwd);
        const ctx = await loadPmContext(state.cwd);
        const prompt = [
            'You are a senior product manager and delivery lead.',
            'Analyze the impact of the following change request.',
            'Use ONLY the provided aligned files and decision ledger as the source of truth; if information is missing, call it out as open questions.',
            '',
            `Change request:\n${change}`,
            '',
            'Decision ledger:',
            renderDecisionForPrompt(ledger),
            '',
            'Aligned files:',
            renderPmContextForPrompt(ctx),
            '',
            'Output (use headings):',
            '1) Summary (what changes, what doesn’t)',
            '2) Affected decisions (which decision IDs to revisit, if any)',
            '3) Affected documents (file path → suggested edits as bullet list)',
            '4) Acceptance criteria changes',
            '5) Analytics/metrics impact',
            '6) Risks & rollout considerations',
            '7) Open questions',
        ].join('\n');
        setState(prev => ({ ...prev, pendingAutomatedPrompt: { label: 'Change Impact', prompt } }));
        return 'Running change impact analysis…';
    },
};
// ── /pack ─────────────────────────────────────────────────────────────────────
const packCommand = {
    name: 'pack',
    description: 'Alignment pack: /pack weekly | /pack feature <name>',
    usage: '/pack weekly | /pack feature <name>',
    examples: [' /pack weekly', ' /pack feature 新支付页'],
    async execute(args, state, setState) {
        const trimmed = args.trim();
        const [sub, ...rest] = trimmed.split(/\s+/);
        const cmd = (sub || '').toLowerCase();
        const title = rest.join(' ').trim();
        if (!cmd || (cmd === 'feature' && !title)) {
            return 'Usage: /pack weekly | /pack feature <name>';
        }
        const ledger = await loadDecisionLedger(state.cwd);
        const ctx = await loadPmContext(state.cwd);
        const kind = cmd === 'weekly' ? 'Weekly Alignment Pack' : `Feature Alignment Pack: ${title}`;
        const prompt = [
            'You are a product lead preparing an alignment pack for cross-functional stakeholders.',
            'Use ONLY the provided aligned files and decision ledger; call out missing info explicitly.',
            '',
            `Pack type: ${kind}`,
            '',
            'Decision ledger:',
            renderDecisionForPrompt(ledger),
            '',
            'Aligned files:',
            renderPmContextForPrompt(ctx),
            '',
            'Output (Markdown):',
            '# TL;DR',
            '# Goals',
            '# Scope (In / Out)',
            '# Current Status',
            '# Key Decisions (with IDs)',
            '# Risks & Mitigations',
            '# Dependencies',
            '# Next Steps / Owners',
            '# Questions to Resolve',
        ].join('\n');
        setState(prev => ({ ...prev, pendingAutomatedPrompt: { label: kind, prompt } }));
        return 'Generating alignment pack…';
    },
};
// ── /session ──────────────────────────────────────────────────────────────────
const sessionCommand = {
    name: 'session',
    description: 'Session tools: /session new|rename|export|fork|list|events|stats|compact',
    usage: '/session new [title] | /session rename <title> | /session export [file] | /session fork <id>? [--keep=N]',
    examples: [' /session new 需求评审', ' /session rename 增长实验 A', ' /session fork', ' /session events 10', ' /session stats'],
    async execute(args, state, setState) {
        const trimmed = args.trim();
        const [sub, ...rest] = trimmed.split(/\s+/);
        const cmd = (sub || '').toLowerCase();
        if (cmd === 'new') {
            const title = rest.join(' ').trim() || undefined;
            const now = Date.now();
            let esId = state.sessionId || randomUUID();
            try {
                const existing = (await sessionStore.listSessions()).map(s => s.id);
                if (!existing.includes(esId)) {
                    esId = await sessionStore.newSession(state.cwd, { id: esId, title: title || `New session ${new Date(now).toLocaleString()}` });
                }
            } catch {}
            setState(prev => ({
                ...prev,
                sessionId: esId,
                sessionCreatedAt: now,
                sessionTitle: title,
                messages: [],
                inputTokens: 0,
                outputTokens: 0,
                planApproved: false,
                pendingPlan: undefined,
                error: null,
            }));
            return title ? `New session created: ${title}  (id=${esId.slice(0,10)}…)` : `New session created. (id=${esId.slice(0,10)}…)`;
        }
        if (cmd === 'rename') {
            const title = rest.join(' ').trim();
            if (!title)
                return 'Usage: /session rename <title>';
            setState(prev => ({ ...prev, sessionTitle: title }));
            await saveSession({
                id: state.sessionId,
                title,
                createdAt: state.sessionCreatedAt,
                updatedAt: Date.now(),
                cwd: state.cwd,
                model: state.model,
                messages: state.messages,
                inputTokens: state.inputTokens,
                outputTokens: state.outputTokens,
            });
            try {
                await sessionStore.appendEvent(state.sessionId, {
                    type: 'SessionMetadataChanged', payload: { title }
                });
            } catch {}
            return `Session renamed: ${title}`;
        }
        if (cmd === 'export') {
            const file = rest.join(' ').trim() || `./guang-session-${state.sessionId.slice(0, 8)}.md`;
            const abs = resolve(state.cwd, file);
            await mkdir(dirname(abs), { recursive: true });
            const header = [
                `# ${state.sessionTitle ?? 'Guang Code Session'}`,
                '',
                `- Session: ${state.sessionId}`,
                `- Updated: ${new Date().toISOString()}`,
                `- CWD: ${state.cwd}`,
                `- Model: ${state.model}`,
                `- Tokens: in=${state.inputTokens} out=${state.outputTokens}`,
                '',
                '---',
                '',
            ].join('\n');
            const body = state.messages
                .filter(m => m.role === 'user' || m.role === 'assistant')
                .filter(m => !m.toolUseId)
                .map(m => {
                const label = m.role === 'user' ? 'User' : 'Assistant';
                const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
                return `## ${label}\n\n${text}\n`;
            })
                .join('\n');
            await writeFile(abs, header + body, 'utf-8');
            return `Session exported: ${abs}`;
        }
        if (cmd === 'fork') {
            // parse --keep=N flag, remaining rest[0] = fromId
            let keepMessages = 99999;
            const fromIdRest = [];
            for (const r of rest) {
                const m = r.match(/^--keep=(\d+)$/);
                if (m) keepMessages = Number(m[1]);
                else fromIdRest.push(r);
            }
            const fromId = fromIdRest[0] || state.sessionId;
            if (!fromId) return 'No session to fork.';
            try {
                const newId = await sessionStore.forkSession(fromId, { keepMessages: keepMessages === 99999 ? undefined : keepMessages });
                const proj = await sessionStore.getProjection(newId);
                // dual write legacy
                await saveSession({
                    id: newId,
                    title: proj.title || `Fork of ${fromId.slice(0, 10)}`,
                    createdAt: proj.created || Date.now(),
                    updatedAt: proj.updated || Date.now(),
                    cwd: proj.cwd || state.cwd,
                    model: state.model,
                    messages: proj.messages,
                    inputTokens: proj.stats.tokensInput,
                    outputTokens: proj.stats.tokensOutput,
                });
                setState(prev => ({
                    ...prev,
                    sessionId: newId,
                    messages: proj.messages,
                    sessionTitle: proj.title || prev.sessionTitle,
                    inputTokens: proj.stats.tokensInput,
                    outputTokens: proj.stats.tokensOutput,
                }));
                return `Forked ${fromId.slice(0, 10)}… → ${newId}  (kept ${proj.messages.length} messages / ${keepMessages === 99999 ? 'all' : 'last ' + keepMessages})`;
            } catch (e) {
                return `Fork failed: ${e.message}`;
            }
        }
        if (cmd === 'list') {
            const esList = await sessionStore.listSessions();
            if (esList.length === 0) return 'No ES sessions yet.';
            const lines = esList.slice(0, 30).map(s => {
                const tag = [
                    s.archived ? 'archived' : 'active',
                    s.messageCount != null ? `msg=${s.messageCount}` : null,
                    s.totalEvents != null ? `ev=${s.totalEvents}` : null,
                    s.forkedFrom ? 'fork' : null,
                ].filter(Boolean).join(',');
                const updated = s.updated ? new Date(s.updated).toISOString().replace('T', ' ').slice(0, 19) : '';
                return `- ${s.id.slice(0, 14)}…  [${tag}]  ${s.title ? s.title.slice(0, 60) : '(untitled)'}  ${updated}`;
            });
            return `ES Sessions (${esList.length}):\n` + lines.join('\n');
        }
        if (cmd === 'events') {
            const n = Number(rest[0]) || 20;
            const all = await sessionStore.readEvents(state.sessionId);
            const tail = all.slice(-n);
            if (tail.length === 0) return 'No events recorded yet.';
            const lines = tail.map(e => {
                const meta = typeof e.payload === 'object' ? Object.entries(e.payload || {}).filter(([k]) => !['message','input'].includes(k)).slice(0, 3).map(([k,v]) => `${k}=${typeof v === 'string' ? v.slice(0, 40) : JSON.stringify(v).slice(0, 40)}`).join(' ') : '';
                return `#${String(e.seq).padStart(4)}  ${e.type.padEnd(26)} ${meta}  @${new Date(e.ts).toLocaleTimeString()}`;
            });
            return `Recent events (${tail.length}/${all.length}):\n` + lines.join('\n');
        }
        if (cmd === 'stats') {
            // Legacy session stats (top) + ES projection stats + pipeline stats
            const legacyMsgCount = state.messages.length;
            let projStr = '';
            try {
                const p = await sessionStore.getProjection(state.sessionId);
                projStr = `
ES store: baseDir=${sessionStore.baseDir}
  events total   = ${p.stats.totalEvents}
  messages       = ${p.messages.length}  (turns=${p.stats.turns})
  tools: calls=${p.stats.toolCalls}  failed=${p.stats.toolCallFailures}
  memory writes  = ${p.stats.memoryWrites}
  tokens: in=${p.stats.tokensInput}  out=${p.stats.tokensOutput}
  skills invoked = ${p.skillsInvoked.size} unique
  tools allowed  = ${p.toolPermissions.size} unique`;
            } catch (e) { projStr = `  (ES projection unavailable: ${e.message})`; }
            const ps = defaultToolPipeline.stats;
            return `
Runtime session stats:
  state messages = ${legacyMsgCount}
  tokens: in=${state.inputTokens}  out=${state.outputTokens}
${projStr}

Tool pipeline stats:
  total calls    = ${ps.totalCalls}  (success=${ps.successes}, fail=${ps.failures})
  cumulative ms  = ${ps.cumulativeMs}
  avg ms/call    = ${ps.totalCalls ? Math.round(ps.cumulativeMs / ps.totalCalls) : 0}

Supported session event types (${SESSION_EVENT_TYPES.length}): ${SESSION_EVENT_TYPES.join(', ')}`;
        }
        if (cmd === 'compact') {
            try {
                const r = await sessionStore.archiveEvents(state.sessionId);
                return r.archived ? `Archived ${r.archived} old events into Brotli segments.` : 'Nothing to compact (fewer than 2000 events).';
            } catch (e) { return `Compact failed: ${e.message}`; }
        }
        return 'Usage: /session new [title] | /session rename <title> | /session export [file] | /session fork [fromId] [--keep=N] | /session list | /session events [N] | /session stats | /session compact';
    },
};
// ── /toolpipeline (diagnostics + tuning) ──────────────────────────────────────
const toolPipelineCommand = {
    name: 'toolpipeline',
    description: 'Inspect / tune the tool execution waterfall: /toolpipeline stats | listeners',
    usage: '/toolpipeline stats | /toolpipeline listeners | /toolpipeline default-timeout <ms>',
    async execute(args, state) {
        const trimmed = args.trim();
        const [sub, ...rest] = trimmed.split(/\s+/);
        const cmd = (sub || 'stats').toLowerCase();
        const ps = defaultToolPipeline.stats;
        if (cmd === 'stats') {
            return `
Tool pipeline stats:
  total calls   = ${ps.totalCalls}
  successes     = ${ps.successes}
  failures      = ${ps.failures}
  cumulative ms = ${ps.cumulativeMs}
  avg ms/call   = ${ps.totalCalls ? Math.round(ps.cumulativeMs / ps.totalCalls) : 0}
  in-flight     = ${Math.max(0, (defaultToolPipeline._callCount ?? 0) - ps.totalCalls)}
`;
        }
        if (cmd === 'listeners') {
            const buckets = ['pre','execute','post','error'];
            const lines = buckets.map(phase => {
                const arr = defaultToolPipeline._listeners?.[phase] ?? [];
                const body = arr.map(l => `    #${l.priority}  ${l.name}${l.disabled?' [DISABLED]':''}`).join('\n');
                return `  [${phase}]  (${arr.length})\n${body}`;
            });
            return `Registered listeners:\n${lines.join('\n')}`;
        }
        if (cmd === 'recent') {
            const id = rest[0];
            if (!id) return 'Usage: /toolpipeline recent <callId>';
            const arr = defaultToolPipeline.recentAudit(id);
            if (arr.length === 0) return `No audit record for callId=${id}`;
            return arr.map(a => `  ${new Date(a.at).toLocaleTimeString()}  phase=${a.phase}  ${a.toolName || ''}  ${a.error ? 'ERROR: ' + String(a.error).slice(0,200) : ''}`).join('\n');
        }
        if (cmd === 'default-timeout') {
            const n = Number(rest[0]);
            if (!n || n < 1000) return 'Usage: /toolpipeline default-timeout <ms>  (at least 1000)';
            defaultToolPipeline._defaultTimeoutMs = n;
            return `Default tool timeout updated to ${n}ms (${(n/1000).toFixed(1)}s).`;
        }
        return 'Usage: /toolpipeline stats|listeners|recent <callId>|default-timeout <ms>';
    },
};
// ── /trust ────────────────────────────────────────────────────────────────────
const trustCommand = {
    name: 'trust',
    description: 'Manage project trust: /trust list | /trust revoke <mcp|hooks> [cwd]',
    usage: '/trust list | /trust revoke <mcp|hooks> [cwd]',
    examples: [' /trust list', ' /trust revoke mcp', ' /trust revoke hooks ../other-project'],
    async execute(args, state, _setState) {
        const trimmed = args.trim();
        const [sub, kindRaw, ...rest] = trimmed.split(/\s+/);
        const cmd = (sub || 'list').toLowerCase();
        if (cmd === 'list') {
            const cfg = await loadConfig();
            const tp = cfg.trustedProjects ?? {};
            const keys = Object.keys(tp);
            if (keys.length === 0)
                return 'No trusted projects.';
            const lines = keys.slice(0, 50).map(k => {
                const v = tp[k];
                const m = v?.mcp?.hash ? String(v.mcp.hash).slice(0, 16) : '';
                const h = v?.hooks?.hash ? String(v.hooks.hash).slice(0, 16) : '';
                const parts = [
                    m ? `mcp:${m}` : null,
                    h ? `hooks:${h}` : null,
                ].filter(Boolean);
                return `- ${k}  ${parts.join('  ')}`;
            });
            return `Trusted projects:\n${lines.join('\n')}`;
        }
        if (cmd === 'revoke') {
            const kind = (kindRaw || '').toLowerCase();
            if (kind !== 'mcp' && kind !== 'hooks')
                return 'Usage: /trust revoke <mcp|hooks> [cwd]';
            const cwd = rest.join(' ').trim() || state.cwd;
            await setTrustedProjectConfig({ cwd, kind: kind, hash: null });
            return `Revoked trust: ${kind} (${cwd})`;
        }
        return 'Usage: /trust list | /trust revoke <mcp|hooks> [cwd]';
    },
};
// ── /exit ─────────────────────────────────────────────────────────────────────
const exitCommand = {
    name: 'exit',
    description: 'Exit Guang Code',
    usage: '/exit',
    noArgs: true,
    async execute() {
        process.exit(0);
    },
};
// ── /commit ───────────────────────────────────────────────────────────────────
const commitCommand = {
    name: 'commit',
    description: 'Create a git commit with AI-generated message',
    async execute(_args, state, _setState) {
        if (!(await isGitRepo(state.cwd))) {
            return "Error: Current directory is not a git repository.";
        }
        const status = await getGitStatus(state.cwd);
        if (!status) {
            return "No changes to commit. Working tree is clean.";
        }
        const diff = await getGitDiff(state.cwd);
        const branch = await getCurrentBranch(state.cwd);
        const prompt = `
[System: Executing /commit command]

Please analyze the following git changes and create a suitable commit message.

## Context
- Current branch: ${branch}
- Status:
${status}
- Diff:
${diff.slice(0, 4000)} ${diff.length > 4000 ? '\n... (diff truncated)' : ''}

## Task
1. Stage all changes using the BashTool (git add .)
2. Create a concise, meaningful commit message (1-2 lines)
3. Execute the commit using the BashTool (git commit -m "...")
4. Summarize what you committed
`;
        return prompt;
    },
};
// ── /style ────────────────────────────────────────────────────────────────────
const styleCommand = {
    name: 'style',
    description: 'Switch output style (default/explanatory/learning)',
    async execute(args, state, setState) {
        const next = args.trim().toLowerCase();
        const cfg = await loadConfig();
        const current = cfg.outputStyle ?? 'default';
        if (!next) {
            return [
                `Current output style: ${current}`,
                '',
                'Available styles:',
                '  • default',
                '  • explanatory',
                '  • learning',
                '',
                'Usage: /style <name>',
            ].join('\n');
        }
        if (next !== 'default' && next !== 'explanatory' && next !== 'learning') {
            return `Unknown style: ${next}. Use: default | explanatory | learning`;
        }
        await setOutputStyle(next);
        const updated = await loadConfig();
        setState(prev => ({ ...prev, providerConfig: updated }));
        return `Output style set to: ${next}`;
    },
};
// ── /permissions ──────────────────────────────────────────────────────────────
const permissionsCommand = {
    name: 'permissions',
    description: 'Manage fine-grained permission rules',
    async execute(args, state, setState) {
        const trimmed = args.trim();
        const [sub, ...rest] = trimmed.split(/\s+/);
        const cmd = (sub || 'list').toLowerCase();
        const cfg = await loadConfig();
        const rules = cfg.permissionRules ?? [];
        if (cmd === 'list') {
            if (rules.length === 0) {
                return [
                    'No permission rules configured.',
                    '',
                    'Usage:',
                    '  /permissions add <allow|deny|ask> <tool> [path=<pattern>] [command=<pattern>]',
                    '  /permissions remove <index>',
                    '  /permissions clear',
                ].join('\n');
            }
            const lines = rules.map((r, i) => {
                const parts = [
                    `${String(i).padStart(2)}  ${r.effect}`,
                    r.tool ? `tool=${r.tool}` : null,
                    r.path ? `path=${r.path}` : null,
                    r.command ? `command=${r.command}` : null,
                    r.description ? `desc=${r.description}` : null,
                ].filter(Boolean);
                return parts.join('  ');
            });
            return ['Permission rules:', ...lines, '', 'Usage: /permissions add|remove|clear|list'].join('\n');
        }
        if (cmd === 'clear') {
            await clearPermissionRules();
            const updated = await loadConfig();
            setState(prev => ({ ...prev, providerConfig: updated }));
            return 'Permission rules cleared.';
        }
        if (cmd === 'remove') {
            const idxRaw = rest[0];
            const idx = idxRaw ? Number(idxRaw) : NaN;
            if (!Number.isFinite(idx))
                return 'Usage: /permissions remove <index>';
            await removePermissionRule(idx);
            const updated = await loadConfig();
            setState(prev => ({ ...prev, providerConfig: updated }));
            return `Removed rule #${idx}.`;
        }
        if (cmd === 'add') {
            const [effectRaw, toolRaw, ...kv] = rest;
            const effect = (effectRaw || '').toLowerCase();
            const tool = toolRaw || '';
            if (!tool || (effect !== 'allow' && effect !== 'deny' && effect !== 'ask')) {
                return 'Usage: /permissions add <allow|deny|ask> <tool> [path=<pattern>] [command=<pattern>]';
            }
            const rule = { effect, tool };
            for (const pair of kv) {
                const eq = pair.indexOf('=');
                if (eq < 0)
                    continue;
                const k = pair.slice(0, eq).toLowerCase();
                const v = pair.slice(eq + 1);
                if (!v)
                    continue;
                if (k === 'path')
                    rule.path = v;
                if (k === 'command')
                    rule.command = v;
                if (k === 'desc' || k === 'description')
                    rule.description = v;
            }
            await addPermissionRule(rule);
            const updated = await loadConfig();
            setState(prev => ({ ...prev, providerConfig: updated }));
            return `Added rule: ${effect} tool=${tool}${rule.path ? ` path=${rule.path}` : ''}${rule.command ? ` command=${rule.command}` : ''}`;
        }
        return 'Usage: /permissions add|remove|clear|list';
    },
};
const skillsCommand = {
    name: 'skills',
    description: 'List available skills with layers (builtin/global/project/runtime) + filter + digest',
    usage: '/skills [scope:<global|project|runtime|builtin>] [search:<text>] [--watch] [--nowatch]',
    async execute(args, state, _setState) {
        // ensure cwd synced + trigger scan
        try { skillLoader.setCwd(state.cwd); skillLoader.scan(); } catch {}
        const raw = args.trim();
        const tokens = raw.split(/\s+/).filter(Boolean);
        const opts = {
            scope: undefined,
            search: undefined,
            tag: undefined,
            watch: null, // true / false / null
        };
        for (const t of tokens) {
            const mScope = t.match(/^scope:(\S+)$/i);
            if (mScope) { opts.scope = mScope[1].toLowerCase(); continue; }
            const mSearch = t.match(/^search:(.+)$/i);
            if (mSearch) { opts.search = mSearch[1]; continue; }
            const mTag = t.match(/^tag:(\S+)$/i);
            if (mTag) { opts.tag = mTag[1]; continue; }
            if (t.toLowerCase() === '--watch')  { opts.watch = true;  continue; }
            if (t.toLowerCase() === '--nowatch') { opts.watch = false; continue; }
            // fallback: treat as search
            opts.search = opts.search ? `${opts.search} ${t}` : t;
        }
        if (opts.watch !== null) {
            if (opts.watch) {
                const ok = skillLoader.startWatchers();
                return ok ? `Skill file watchers started (${skillLoader['_watchers'].size} dirs). Changes will auto-trigger scan.` : 'Watchers not available (fs.watch not supported).';
            } else {
                skillLoader.stopWatchers();
                return 'Skill file watchers stopped.';
            }
        }
        const skillsList = skillLoader.list({
            scope: opts.scope, search: opts.search, tag: opts.tag, userInvocableOnly: false, includeHidden: true,
        });
        const sd = skillLoader.lastScanReport;
        const counts = sd?.counts ?? {};
        const header = [
            `Skill loader: loaded=${skillLoader.loadedCount}  watchers=${skillLoader.hasWatchers ? 'ON' : 'off'}  cwd=${state.cwd}`,
            `Layers: builtin=${counts.builtin ?? 0}  global=${counts.global ?? 0}  project=${counts.project ?? 0}  runtime=${counts.runtime ?? 0}  session=${counts.session ?? 0}`,
            sd?.changed?.length ? `Changed on last scan: ${sd.changed.map(c => c.skillId + '@' + (c.scope || '?')).join(', ')}` : null,
            '',
        ].filter(Boolean);
        if (skillsList.length === 0) {
            return [...header, 'No skills matched.'].join('\n');
        }
        const lines = skillsList.slice(0, 80).map(s => {
            const flags = [
                s.scope,
                s.version ? `v${s.version}` : null,
                s.hidden ? 'hidden' : null,
                !s.userInvocable ? 'sys-only' : null,
                s.digest ? s.digest.slice(0, 8) : null,
            ].filter(Boolean).join(',');
            const tagStr = s.tags?.length ? ` [${s.tags.join(',')}]` : '';
            return `- ${String(s.id).padEnd(26)}  [${flags}]  ${s.description.slice(0, 80)}${tagStr}`;
        });
        return [...header, `Skills (${skillsList.length}):`, ...lines, '', 'Run: /skill <id> [args]  |  inject: /skill inject <id> <markdown>  |  remove (runtime): /skill remove <id>'].join('\n');
    },
};
const skillCommand = {
    name: 'skill',
    description: 'Execute / inject / list skills',
    usage: '/skill <id> [args] | /skill inject <id> <markdown> | /skill remove <id> | /skill show <id> | /skill dirs',
    async execute(args, state, _setState) {
        const trimmed = args.trim();
        if (!trimmed)
            return 'Usage: /skill <id> [args]  |  /skill inject <id> <markdown with frontmatter>  |  /skill remove <id>  |  /skill show <id>  |  /skill dirs';
        const [head, ...rest] = trimmed.split(' ');
        const sub = head.toLowerCase();
        if (sub === 'dirs') {
            const sd = skillLoader.scopeDirs;
            return [
                'Skill directory search order (later wins on id collision):',
                `  1. builtin  = ${sd.builtin || '(unset — set env GC_BUILTIN_SKILLS_DIR)'}`,
                `  2. global   = ${sd.global}  (env GC_USER_SKILLS_DIR)`,
                `  3. project  = ${sd.project}`,
                `  4. runtime  = (in-memory injections via /skill inject)`,
            ].join('\n');
        }
        if (sub === 'show') {
            const id = rest[0];
            if (!id) return 'Usage: /skill show <id>';
            const s = skillLoader.get(id);
            if (!s) return `Skill not found: ${id}`;
            const meta = [
                `id         = ${s.id}`,
                `name       = ${s.name}`,
                `scope      = ${s.scope}`,
                `version    = ${s.version ?? '1.0.0'}`,
                `digest     = ${s.digest ?? 'n/a'}`,
                `tags       = ${(s.tags ?? []).join(', ') || '(none)'}`,
                `sourcePath = ${s.sourcePath ?? '(in-memory)'}` ,
                `allowed    = ${(s.allowedTools ?? []).join(', ') || '*'}` ,
                `forbidden  = ${(s.forbiddenTools ?? []).join(', ') || '(none)'}` ,
                `args       = ${(s.arguments ?? []).join(', ') || '(none)'}` ,
            ].join('\n');
            return `---\n${meta}\n---\n${s.prompt}`;
        }
        if (sub === 'inject') {
            const id = rest[0];
            if (!id) return 'Usage: /skill inject <id> <markdown skill content (with optional frontmatter)>';
            const md = rest.slice(1).join(' ');
            if (!md.trim()) return 'Missing skill markdown content.';
            try {
                const parsed = skillLoader.inject(md, { id, scope: 'runtime' });
                return `Skill injected: ${parsed.id}@${parsed.scope}  digest=${parsed.digest.slice(0,12)}`;
            } catch (e) { return `Inject failed: ${e.message}`; }
        }
        if (sub === 'remove') {
            const id = rest[0];
            if (!id) return 'Usage: /skill remove <id>';
            const ok = skillLoader.remove(id);
            return ok ? `Removed runtime skill: ${id}` : `Cannot remove skill ${id} (only scope=runtime or scope=session skills can be removed via /skill remove).`;
        }
        // Default: execute skill <id> [args]
        const id = head;
        const skillArgs = rest.join(' ');
        const s = skillLoader.get(id);
        if (!s) {
            // fallback to original skills.js loader in case skillLoader hasn't caught up yet
            const fallbacks = loadAllSkills(state.cwd);
            const fb = fallbacks.find(x => x.id === id);
            if (!fb) return `Skill not found: ${id}`;
            return renderSkillInvocation(fb, skillArgs);
        }
        // Record SkillInvoked event if session is tracked
        try { await sessionStore.appendEvent(state.sessionId, { type: 'SkillInvoked', payload: { skillId: s.id, argsPreview: skillArgs.slice(0,200) } }); } catch {}
        return skillLoader.renderInvocation(s, skillArgs);
    },
};
const memoryCommand = {
    name: 'memory',
    description: 'Manage persistent project memory',
    async execute(args, state, setState) {
        const trimmed = args.trim();
        const [sub, ...rest] = trimmed.split(/\s+/);
        const cmd = (sub || 'list').toLowerCase();
        const cfg = await loadConfig();
        const baseDir = cfg.memoryDirectory;
        const memoryCfg = getMemoryConfigFromGcConfig(cfg);
        if (cmd === 'enable' || cmd === 'disable') {
            await setMemoryEnabled(cmd === 'enable');
            const updated = await loadConfig();
            setState(prev => ({ ...prev, providerConfig: updated }));
            return `Memory ${cmd === 'enable' ? 'enabled' : 'disabled'}.`;
        }
        if (cmd === 'dir') {
            const next = rest.join(' ').trim();
            if (!next) {
                const cur = (cfg.memoryDirectory && cfg.memoryDirectory.trim()) ? cfg.memoryDirectory.trim() : '(default)';
                return `Memory base directory: ${cur}`;
            }
            await setMemoryDirectory(next);
            const updated = await loadConfig();
            setState(prev => ({ ...prev, providerConfig: updated }));
            return `Memory base directory set to: ${next}`;
        }
        if (cmd === 'path') {
            return `Project memory dir:\n${getProjectMemoryDir(state.cwd, { baseDir })}`;
        }
        if (cmd === 'init') {
            const created = ensureMemoryIndexExists(state.cwd, { baseDir });
            return `Memory initialized:\n${created.entrypoint}`;
        }
        // ── New sub-command: backend — show/switch backend ────────
        if (cmd === 'backend') {
            const want = (rest[0] || '').toLowerCase();
            if (!want) {
                const stats = await memoryRegistry.stats(cfg);
                const servers = stats.mcp.connectedServers
                const caps = stats.mcp.details.map(d => `    • ${d.server}: add=${d.caps?.add ?? 'n/a'} search=${d.caps?.search ?? 'n/a'} list=${d.caps?.list ?? 'n/a'}`)
                return [
                    `Memory backend config:`,
                    `  backend        = ${memoryCfg.backend}   (legacy | kv | mcp | hybrid)`,
                    `  kvBackend      = ${memoryCfg.kvBackend}`,
                    `  mcpPreferred   = ${(memoryCfg.mcpPreferredServer ?? '(auto)') || '(auto)'}`,
                    `  mcpFallbackKV  = ${memoryCfg.mcpFallbackToKV}`,
                    `  legacyDualWrite= ${memoryCfg.legacyDualWrite}`,
                    ``,
                    `KV stats: backend=${stats.kv.backend} entries=${stats.kv.entriesTotal} migrated=${stats.kv.legacyMigratedCount}`,
                    ``,
                    `MCP connected servers (${servers.length}):`,
                    ...(caps.length > 0 ? caps : ['    (none) — put config in .guang/mcp.json and run /trust mcp']),
                    ``,
                    `To switch: /memory backend <legacy|kv|mcp|hybrid>`,
                ].join('\n');
            }
            if (!['legacy', 'kv', 'mcp', 'hybrid'].includes(want)) {
                return 'Unknown backend. Usage: /memory backend [legacy|kv|mcp|hybrid]';
            }
            const next = { ...cfg, memory: { ...(cfg.memory && typeof cfg.memory === 'object' ? cfg.memory : {}), backend: want } };
            await (await import('../utils/config.js')).saveConfig(next);
            const updated = await loadConfig();
            setState(prev => ({ ...prev, providerConfig: updated }));
            return `Memory backend switched to: ${want}`;
        }
        // ── New sub-command: migrate legacy -> kv ────────────────
        if (cmd === 'migrate-kv' || cmd === 'migrate') {
            const n = await memoryRegistry.migrateLegacyToKV(state.cwd, { baseDir }, cfg);
            return `Migrated ${n} entries from markdown files to KV store (${getMemoryConfigFromGcConfig(await loadConfig()).kvBackend} backend).`;
        }
        // ── New sub-command: kv backend switch ───────────────────
        if (cmd === 'kv-backend') {
            const want = (rest[0] || '').toLowerCase();
            if (!want) {
                return `Current KV backend: ${memoryCfg.kvBackend}. Usage: /memory kv-backend <json|sqlite>`;
            }
            if (!['json', 'sqlite'].includes(want)) return 'Valid KV backends: json | sqlite';
            const next = { ...cfg, memory: { ...(cfg.memory && typeof cfg.memory === 'object' ? cfg.memory : {}), kvBackend: want } };
            await (await import('../utils/config.js')).saveConfig(next);
            const updatedCfg = await loadConfig();
            setState(prev => ({ ...prev, providerConfig: updatedCfg }));
            return `KV backend switched to: ${want}. (SQLite requires npm i better-sqlite3)`;
        }
        // ── New sub-command: mcp prefer ──────────────────────────
        if (cmd === 'mcp-prefer') {
            const want = (rest[0] || '').trim();
            if (!want) {
                return `Current MCP preferred server: ${memoryCfg.mcpPreferredServer ?? '(auto)'}. Usage: /memory mcp-prefer <serverName>`;
            }
            const next = { ...cfg, memory: { ...(cfg.memory && typeof cfg.memory === 'object' ? cfg.memory : {}), mcpPreferredServer: want } };
            await (await import('../utils/config.js')).saveConfig(next);
            const updatedCfg2 = await loadConfig();
            setState(prev => ({ ...prev, providerConfig: updatedCfg2 }));
            return `MCP preferred server set to: ${want}   (will auto-discover if server is in .guang/mcp.json)`;
        }
        // ── New sub-command: stats ───────────────────────────────
        if (cmd === 'stats') {
            const stats = await memoryRegistry.stats(cfg);
            return JSON.stringify(stats, null, 2);
        }
        // ── New sub-command: search ──────────────────────────────
        if (cmd === 'search') {
            const q = rest.join(' ').trim();
            if (!q) return 'Usage: /memory search <query>';
            const entries = await memoryRegistry.searchEntries(state.cwd, { query: q, limit: 20 }, cfg);
            if (!entries || entries.length === 0) return `No memory matches: ${q}`;
            return [
                `Memory search results for: ${q}`,
                ...entries.map(e => `- ${e.id}  [${e.type}]  ${e.name || '(untitled)'}${e.description ? ` — ${e.description}` : ''}`),
            ].join('\n');
        }
        if (cmd === 'list') {
            const entries = await memoryRegistry.listEntries(state.cwd, { baseDir }, cfg);
            if (entries.length === 0) {
                return [
                    'No memory entries found.',
                    '',
                    'Usage:',
                    '  /memory add [user|project|reference|feedback] :: <markdown>',
                    '  /memory show <id>',
                    '  /memory remove <id>',
                    '  /memory path',
                    '  /memory init',
                    '  /memory enable|disable',
                    '  /memory dir [path]',
                    '  /memory backend [legacy|kv|mcp|hybrid]',
                    '  /memory kv-backend [json|sqlite]',
                    '  /memory mcp-prefer [serverName]',
                    '  /memory migrate',
                    '  /memory stats',
                    '  /memory search <query>',
                ].join('\n');
            }
            const lines = entries.slice(0, 50).map(e => `- ${e.id}  [${e.type}]  ${e.name || ''}${e.description ? ` — ${e.description}` : ''}`);
            return [`Memory entries (backend=${memoryCfg.backend}):`, ...lines, '', 'Usage: /memory add [type] :: <markdown>'].join('\n');
        }
        if (cmd === 'add') {
            const restText = rest.join(' ').trim();
            const sep = restText.indexOf('::');
            if (sep < 0)
                return 'Usage: /memory add [user|project|reference|feedback] :: <markdown>';
            const header = restText.slice(0, sep).trim();
            const body = restText.slice(sep + 2).trim();
            if (!body)
                return 'Usage: /memory add :: <markdown>';
            const type = (header === 'user' || header === 'project' || header === 'reference' || header === 'feedback')
                ? header
                : 'project';
            const entry = await memoryRegistry.addEntry(state.cwd, { type, body, baseDir }, cfg);
            return `Memory saved: ${entry.id}${entry.mcpEntry ? ' (also wrote to MCP backend)' : ''}`;
        }
        if (cmd === 'show') {
            const id = rest[0];
            if (!id)
                return 'Usage: /memory show <id>';
            const entry = await memoryRegistry.getEntry(state.cwd, id, cfg);
            if (!entry)
                return `Memory not found: ${id}`;
            if (typeof entry === 'object' && entry.content !== undefined) {
                const head = `# ${entry.name || '(untitled)'}   [${entry.type || 'project'}]\nid=${entry.id}\n`;
                return head + '\n' + (entry.content || '');
            }
            return typeof entry === 'string' ? entry : String(entry);
        }
        if (cmd === 'remove') {
            const id = rest[0];
            if (!id)
                return 'Usage: /memory remove <id>';
            const res = await memoryRegistry.removeEntry(state.cwd, id, cfg);
            if (!res.ok)
                return res.error ?? 'Remove failed';
            return `Removed memory: ${id}`;
        }
        return 'Usage: /memory list|add|show|remove|path|init|enable|disable|dir|backend|kv-backend|mcp-prefer|migrate|stats|search';
    },
};
const cronCommand = {
    name: 'cron',
    description: 'Manage scheduled tasks in .guang/scheduled_tasks.json',
    async execute(args, state, _setState) {
        const trimmed = args.trim();
        const [sub, ...rest] = trimmed.split(/\s+/);
        const cmd = (sub || 'list').toLowerCase();
        if (cmd === 'list') {
            const tasks = listProjectCronTasks(state.cwd);
            if (tasks.length === 0) {
                return [
                    'No scheduled tasks configured.',
                    '',
                    'Usage:',
                    '  /cron add <cron expr> :: <prompt>',
                    '  /cron add-once <cron expr> :: <prompt>',
                    '  /cron enable <id>',
                    '  /cron disable <id>',
                    '  /cron run <id>',
                    '  /cron remove <id>',
                    '  /cron clear',
                    '',
                    'Cron expr: "min hour dom month dow" (supports *, ranges, lists, */step)',
                    'Example: */5 * * * *',
                ].join('\n');
            }
            const lines = tasks.map(t => {
                const flags = [
                    t.enabled === false ? 'disabled' : null,
                    t.recurring === false ? 'once' : 'recurring',
                ].filter(Boolean).join(', ');
                return `- ${t.id}  ${t.cron}  (${flags})\n  ${t.prompt.replace(/\n+/g, ' ').slice(0, 160)}`;
            });
            return ['Scheduled tasks:', ...lines].join('\n');
        }
        if (cmd === 'clear') {
            clearProjectCronTasks(state.cwd);
            return 'Scheduled tasks cleared.';
        }
        if (cmd === 'remove') {
            const id = rest[0];
            if (!id)
                return 'Usage: /cron remove <id>';
            const res = removeProjectCronTask(state.cwd, id);
            if (!res.ok)
                return res.error ?? 'Remove failed';
            return `Removed task: ${id}`;
        }
        if (cmd === 'enable' || cmd === 'disable') {
            const id = rest[0];
            if (!id)
                return `Usage: /cron ${cmd} <id>`;
            const res = setProjectCronTaskEnabled(state.cwd, id, cmd === 'enable');
            if (!res.ok)
                return res.error ?? 'Update failed';
            return `${cmd === 'enable' ? 'Enabled' : 'Disabled'} task: ${id}`;
        }
        if (cmd === 'run') {
            const id = rest[0];
            if (!id)
                return 'Usage: /cron run <id>';
            const tasks = listProjectCronTasks(state.cwd);
            const task = tasks.find(t => t.id === id);
            if (!task)
                return `Task not found: ${id}`;
            return `[Scheduled Task: ${id}]\n${task.prompt}`;
        }
        if (cmd === 'add' || cmd === 'add-once') {
            const raw = rest.join(' ').trim();
            const sep = raw.indexOf('::');
            if (sep < 0)
                return 'Usage: /cron add <cron expr> :: <prompt>';
            const cronExpr = raw.slice(0, sep).trim();
            const prompt = raw.slice(sep + 2).trim();
            if (!cronExpr || !prompt)
                return 'Usage: /cron add <cron expr> :: <prompt>';
            if (!parseCronExpression(cronExpr)) {
                return `Invalid cron expression: ${cronExpr}`;
            }
            const task = addProjectCronTask(state.cwd, {
                cron: cronExpr,
                prompt,
                recurring: cmd !== 'add-once',
                enabled: true,
            });
            return `Scheduled task created: ${task.id}`;
        }
        return 'Usage: /cron list|add|add-once|remove|enable|disable|run|clear';
    },
};
// ── /ui ───────────────────────────────────────────────────────────────────────
const uiCommand = {
    name: 'ui',
    aliases: ['web', 'webui'],
    description: 'Start / stop / status the built-in Web UI server (DSH-style console)',
    help: [
        '/ui start [--port=5173] [--host=127.0.0.1]   — Start the web UI and open it in browser',
        '/ui stop                                       — Stop the running web UI server',
        '/ui status                                     — Show server URL + running state',
        '/ui open                                       — Open the running UI in your browser',
    ].join('\n'),
    async execute(args, state, setState) {
        const argv = String(args || '').trim();
        const tokens = argv.split(/\s+/).filter(Boolean);
        const cmd = tokens.shift() || 'status';
        const opts = {};
        for (const t of tokens) {
            if (t.startsWith('--port=')) opts.port = parseInt(t.slice(7), 10);
            else if (t.startsWith('--host=')) opts.host = t.slice(7);
            else if (t === '--public') opts.host = opts.host || '0.0.0.0';
        }
        if (cmd === 'start') {
            try {
                const r = await startWebServer({ cwd: state.cwd, port: opts.port, host: opts.host });
                const ws = getWebServer();
                const opened = await _openBrowserMaybe(r.url);
                return [
                    `✅ Web UI ${r.existing ? 'was already' : ''} running at`,
                    `   ${r.url}`,
                    `   Host: ${ws.host} · Port: ${ws.port}`,
                    opened ? `   (Browser launch attempted)` : '   (Run /ui open to open browser)',
                    '',
                    'Panels:',
                    '  💬 Chat    — Sessions + messages + event log',
                    '  📂 Sessions — Full session list',
                    '  🧠 Skills   — 5-scope skill registry with scope filter',
                    '  🧩 Plugins  — Runtime plugin propose + approve/deny + sandbox',
                    '  🛠️ SDK      — MCP / ACP / JSON-RPC interop ping + tools',
                    '',
                    'Endpoints:  POST /sdk/v1    (JSON-RPC / ACP / MCP)',
                    '            GET  /sdk/v1/sse (server-push subscriptions)',
                    '            GET  /api/ui/*   (convenience REST)',
                ].join('\n');
            } catch (e) {
                return `❌ Failed to start web UI: ${e.message}\n${e.stack || ''}`;
            }
        }
        if (cmd === 'stop') {
            const r = await stopWebServer();
            return r.wasRunning ? '🛑 Web UI stopped.' : 'Web UI was not running.';
        }
        if (cmd === 'status') {
            const ws = getWebServer();
            if (!ws || !ws.isRunning()) return 'Web UI: not running (use /ui start).';
            return [
                `Web UI running at: ${ws.getUrl()}`,
                `  Host: ${ws.host} · Port: ${ws.port}`,
                `  Tools exposed (SDK): ${ws.sdkServer ? '✓ attached' : '—'}`,
                `  UI dir: ${ws.uiDir}`,
            ].join('\n');
        }
        if (cmd === 'open') {
            const ws = getWebServer();
            if (!ws || !ws.isRunning()) {
                const r = await startWebServer({ cwd: state.cwd });
                await _openBrowserMaybe(r.url);
                return `✅ Started and opened: ${r.url}`;
            }
            await _openBrowserMaybe(ws.getUrl());
            return `🌐 Opened: ${ws.getUrl()}`;
        }
        return this.help;
    },
};
// small helper: best-effort browser open, returns true if attempted
async function _openBrowserMaybe(url) {
    try {
        const { platform } = process;
        const args = platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
            : platform === 'darwin' ? ['open', [url]]
            : ['xdg-open', [url]];
        const { spawn } = await import('child_process');
        spawn(args[0], args[1], { detached: true, stdio: 'ignore' }).unref();
        return true;
    } catch { return false; }
}
// ── Registry ──────────────────────────────────────────────────────────────────
export const builtInSlashCommands = [
    helpCommand,
    clearCommand,
    costCommand,
    modelCommand,
    providersCommand,
    keysCommand,
    modeCommand,
    planCommand,
    styleCommand,
    permissionsCommand,
    skillsCommand,
    skillCommand,
    memoryCommand,
    cronCommand,
    compactCommand,
    pluginCommand,
    sdkCommand,
    alignCommand,
    decisionCommand,
    impactCommand,
    packCommand,
    sessionsCommand,
    resumeCommand,
    sessionCommand,
    toolPipelineCommand,
    templateCommand,
    trustCommand,
    tasksCommand,
    taskCancelCommand,
    taskRetryCommand,
    sendCommand,
    commitCommand,
    uiCommand,
    exitCommand,
];
export function getAllSlashCommands(cwd) {
    const customCommands = loadCustomCommands(cwd);
    return [...builtInSlashCommands, ...customCommands];
}
export function findSlashCommand(input, cwd = process.cwd()) {
    if (!input.startsWith('/'))
        return null;
    const [cmdPart, ...rest] = input.slice(1).split(' ');
    const args = rest.join(' ');
    const allCommands = getAllSlashCommands(cwd);
    const command = allCommands.find(c => c.name === cmdPart?.toLowerCase());
    if (!command)
        return null;
    return { command, args };
}
