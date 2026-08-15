// ============================================================
//  Guang Code — Main REPL App Component
// ============================================================
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import figures from 'figures';
import { MessageView } from './Message.js';
import { Spinner } from './Spinner.js';
import { PermissionRequest } from './PermissionRequest.js';
import { StatusBar } from './StatusBar.js';
import { runQuery } from '../utils/QueryEngine.js';
import { loadProjectInstructions } from '../utils/projectInstructions.js';
import { findSlashCommand, getAllSlashCommands } from '../commands/slashCommands.js';
import { saveSession } from '../utils/sessionStorage.js';
import { randomUUID } from 'crypto';
import { onSubagentEvent } from '../utils/subagents.js';
import { claimDueProjectCronRuns, finalizeProjectCronRun } from '../utils/cronTasks.js';
export function App({ initialState, apiKeyOverride }) {
    const [state, setState] = useState(initialState);
    const [inputValue, setInputValue] = useState('');
    const [inputHistory, setInputHistory] = useState([]);
    const [historyIndex, setHistoryIndex] = useState(-1);
    const [streamingText, setStreamingText] = useState('');
    const [spinnerText, setSpinnerText] = useState('');
    const [paletteOpen, setPaletteOpen] = useState(false);
    const [paletteQuery, setPaletteQuery] = useState('');
    const [paletteIndex, setPaletteIndex] = useState(0);
    const [tabCycle, setTabCycle] = useState({ base: '', index: 0 });
    const abortRef = useRef(null);
    const bgSeenRef = useRef(new Set());
    const stateRef = useRef(state);
    const cronQueueRef = useRef([]);
    const cronProcessingRef = useRef(false);
    useEffect(() => {
        stateRef.current = state;
    }, [state]);
    const allSlashCommands = useMemo(() => getAllSlashCommands(state.cwd), [state.cwd]);
    const paletteItems = useMemo(() => {
        const q = paletteQuery.trim().toLowerCase();
        const scored = allSlashCommands.map(c => {
            const name = c.name.toLowerCase();
            const desc = (c.description ?? '').toLowerCase();
            let score = 0;
            if (!q)
                score = 1;
            else if (name === q)
                score = 100;
            else if (name.startsWith(q))
                score = 60 - (name.length - q.length);
            else if (name.includes(q))
                score = 40 - Math.max(0, name.indexOf(q));
            else if (desc.includes(q))
                score = 20 - Math.max(0, desc.indexOf(q));
            return { name: c.name, description: c.description, usage: c.usage, examples: c.examples, noArgs: c.noArgs, score };
        });
        return scored
            .filter(x => x.score > 0)
            .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
            .slice(0, 12);
    }, [allSlashCommands, paletteQuery]);
    const slashSuggestions = useMemo(() => {
        if (state.isLoading || paletteOpen)
            return [];
        const v = inputValue;
        if (!v.startsWith('/'))
            return [];
        if (v.includes(' '))
            return [];
        const q = v.slice(1).trim().toLowerCase();
        const scored = allSlashCommands.map(c => {
            const name = c.name.toLowerCase();
            const desc = (c.description ?? '').toLowerCase();
            let score = 0;
            if (!q)
                score = 1;
            else if (name === q)
                score = 100;
            else if (name.startsWith(q))
                score = 60 - (name.length - q.length);
            else if (name.includes(q))
                score = 40 - Math.max(0, name.indexOf(q));
            else if (desc.includes(q))
                score = 20 - Math.max(0, desc.indexOf(q));
            return { name: c.name, description: c.description, usage: c.usage, examples: c.examples, noArgs: c.noArgs, score };
        });
        return scored
            .filter(x => x.score > 0)
            .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
            .slice(0, 5);
    }, [allSlashCommands, inputValue, paletteOpen, state.isLoading]);
    const activeSlashHelp = useMemo(() => {
        const v = inputValue;
        if (!v.startsWith('/'))
            return null;
        const token = v.slice(1).split(/\s+/)[0]?.trim().toLowerCase();
        if (!token)
            return null;
        const exact = allSlashCommands.find(c => c.name.toLowerCase() === token);
        const best = exact ?? (slashSuggestions.length > 0 ? allSlashCommands.find(c => c.name === slashSuggestions[0].name) : undefined);
        if (!best)
            return null;
        const usage = best.usage ? best.usage : `/${best.name}${best.noArgs ? '' : ' …'}`;
        const examples = best.examples ?? [];
        return { name: best.name, description: best.description, usage, examples };
    }, [allSlashCommands, inputValue, slashSuggestions]);
    useEffect(() => {
        const v = inputValue;
        if (!v.startsWith('/') || v.includes(' ')) {
            if (tabCycle.base)
                setTabCycle({ base: '', index: 0 });
            return;
        }
        const base = v.slice(1);
        if (tabCycle.base && tabCycle.base !== base) {
            setTabCycle({ base: '', index: 0 });
        }
    }, [inputValue, tabCycle.base]);
    const runAutomatedPrompt = useCallback(async (promptText, label, kind) => {
        const cur = stateRef.current;
        if (cur.isLoading || cur.pendingPermission)
            return false;
        let hadError = false;
        const userMsg = {
            id: randomUUID(),
            role: 'user',
            content: kind === 'cron' ? `[Scheduled Task: ${label}]\n${promptText}` : `[Automated: ${label}]\n${promptText}`,
            timestamp: Date.now(),
        };
        setState(prev => ({ ...prev, messages: [...prev.messages, userMsg], isLoading: true, error: null }));
        setStreamingText('');
        setSpinnerText('thinking...');
        const abort = new AbortController();
        abortRef.current = abort;
        try {
            const { messages: newMsgs, inputTokens, outputTokens } = await runQuery({
                messages: [...cur.messages, userMsg],
                model: cur.model,
                cwd: cur.cwd,
                permissionMode: cur.permissionMode,
                planApproved: cur.planApproved,
                providerConfig: cur.providerConfig,
                apiKeyOverride,
                signal: abort.signal,
                onPermissionRequest: async (toolName, description) => {
                    const latest = stateRef.current;
                    if (latest.permissionMode === 'auto')
                        return 'always_allow';
                    return new Promise((resolve) => {
                        const pending = {
                            id: randomUUID(), toolName, description,
                            resolve: (approved) => {
                                setState(prev => ({ ...prev, pendingPermission: null }));
                                resolve(approved);
                            },
                        };
                        setState(prev => ({ ...prev, pendingPermission: pending }));
                    });
                },
                onStreamChunk: (chunk) => {
                    if (chunk.type === 'text_delta') {
                        setStreamingText(prev => prev + (chunk.text ?? ''));
                    }
                    else if (chunk.type === 'tool_start') {
                        const name = chunk.toolName ?? '';
                        setSpinnerText(name && name !== '…' ? `${name}…` : 'thinking...');
                        setStreamingText('');
                    }
                    else if (chunk.type === 'tool_done') {
                        setSpinnerText('thinking...');
                    }
                    else if (chunk.type === 'error') {
                        hadError = true;
                        setState(prev => ({ ...prev, error: chunk.error ?? 'Unknown error', isLoading: false }));
                        setSpinnerText('');
                        setStreamingText('');
                    }
                },
            });
            setState(prev => {
                const combined = [...prev.messages, ...newMsgs];
                const lastAssistant = [...newMsgs].reverse().find(m => m.role === 'assistant' && !m.toolUseId && typeof m.content === 'string');
                const pendingPlan = prev.permissionMode === 'plan' && !prev.planApproved
                    ? (typeof lastAssistant?.content === 'string' ? String(lastAssistant.content) : prev.pendingPlan)
                    : prev.pendingPlan;
                const updated = {
                    ...prev,
                    messages: combined,
                    isLoading: false,
                    inputTokens: prev.inputTokens + inputTokens,
                    outputTokens: prev.outputTokens + outputTokens,
                    pendingPermission: null,
                    spinnerText: '',
                    pendingPlan,
                };
                saveSession({
                    id: prev.sessionId,
                    title: prev.sessionTitle,
                    createdAt: prev.sessionCreatedAt,
                    updatedAt: Date.now(),
                    cwd: prev.cwd,
                    model: prev.model,
                    messages: combined,
                    inputTokens: updated.inputTokens,
                    outputTokens: updated.outputTokens,
                }).catch(() => { });
                return updated;
            });
            return !hadError;
        }
        catch (err) {
            const e = err;
            if (e.name !== 'AbortError') {
                setState(prev => ({ ...prev, isLoading: false, error: e.message, pendingPermission: null }));
            }
            else {
                setState(prev => ({ ...prev, isLoading: false, pendingPermission: null }));
            }
            return false;
        }
        setStreamingText('');
        setSpinnerText('');
    }, [apiKeyOverride]);
    useEffect(() => {
        const cur = stateRef.current;
        const pending = cur.pendingAutomatedPrompt;
        if (!pending)
            return;
        if (cur.isLoading || cur.pendingPermission)
            return;
        setState(prev => ({ ...prev, pendingAutomatedPrompt: undefined }));
        runAutomatedPrompt(pending.prompt, pending.label, 'command').catch(() => { });
    }, [state.pendingAutomatedPrompt, runAutomatedPrompt]);
    const processCronQueue = useCallback(async () => {
        if (cronProcessingRef.current)
            return;
        cronProcessingRef.current = true;
        try {
            while (true) {
                const cur = stateRef.current;
                if (cur.isLoading || cur.pendingPermission)
                    return;
                const next = cronQueueRef.current.shift();
                if (!next)
                    return;
                const label = `${next.task.id}@${new Date(next.bucket).toISOString().slice(0, 16)}`;
                const ok = await runAutomatedPrompt(next.task.prompt, label, 'cron');
                finalizeProjectCronRun(cur.cwd, { task: next.task, bucket: next.bucket }, ok);
            }
        }
        finally {
            cronProcessingRef.current = false;
        }
    }, [runAutomatedPrompt]);
    useEffect(() => {
        const interval = setInterval(async () => {
            const cur = stateRef.current;
            if (cur.isLoading || cur.pendingPermission)
                return;
            const claimed = claimDueProjectCronRuns(cur.cwd, new Date());
            if (claimed.runs.length > 0) {
                const maxQueue = 20;
                const existing = new Set(cronQueueRef.current.map(r => `${r.task.id}:${r.bucket}`));
                for (const r of claimed.runs) {
                    const key = `${r.task.id}:${r.bucket}`;
                    if (existing.has(key))
                        continue;
                    cronQueueRef.current.push(r);
                    existing.add(key);
                    if (cronQueueRef.current.length >= maxQueue)
                        break;
                }
            }
            await processCronQueue();
        }, 5_000);
        return () => clearInterval(interval);
    }, [processCronQueue]);
    useEffect(() => {
        const off = onSubagentEvent(e => {
            if (e.type === 'started') {
                setState(prev => ({
                    ...prev,
                    messages: [
                        ...prev.messages,
                        {
                            id: randomUUID(),
                            role: 'assistant',
                            content: `[Tool: Task]\nInput: ${JSON.stringify({ id: e.id, run_in_background: true, description: e.description }, null, 2)}`,
                            timestamp: Date.now(),
                            toolUseId: e.id,
                        },
                    ],
                }));
                return;
            }
            if (e.type === 'named') {
                setState(prev => ({
                    ...prev,
                    messages: [
                        ...prev.messages,
                        {
                            id: randomUUID(),
                            role: 'assistant',
                            content: `[Task ${e.id} named]\n\n${e.name}`,
                            timestamp: Date.now(),
                            toolUseId: e.id,
                        },
                    ],
                }));
                return;
            }
            if (e.type === 'progress') {
                const key = `${e.id}:${e.message}`;
                if (bgSeenRef.current.has(key))
                    return;
                bgSeenRef.current.add(key);
                setState(prev => ({
                    ...prev,
                    messages: [
                        ...prev.messages,
                        {
                            id: randomUUID(),
                            role: 'assistant',
                            content: `[Tool: Task]\n${e.message}`,
                            timestamp: Date.now(),
                            toolUseId: e.id,
                        },
                    ],
                }));
                return;
            }
            if (e.type === 'completed') {
                setState(prev => ({
                    ...prev,
                    messages: [
                        ...prev.messages,
                        {
                            id: randomUUID(),
                            role: 'assistant',
                            content: `[Task ${e.id} completed]\n\n${e.report}`,
                            timestamp: Date.now(),
                        },
                    ],
                }));
                return;
            }
            if (e.type === 'failed') {
                setState(prev => ({
                    ...prev,
                    messages: [
                        ...prev.messages,
                        {
                            id: randomUUID(),
                            role: 'assistant',
                            content: `[Task ${e.id} failed]\n\n${e.error}`,
                            timestamp: Date.now(),
                        },
                    ],
                }));
            }
        });
        return off;
    }, []);
    // ── Keyboard input ─────────────────────────────────────────
    useInput((input, key) => {
        if (key.ctrl && input === 'c') {
            if (state.isLoading && abortRef.current) {
                abortRef.current.abort();
                setState(prev => ({ ...prev, isLoading: false }));
                setStreamingText('');
                setSpinnerText('');
            }
            return;
        }
        if (key.ctrl && input === 'd')
            process.exit(0);
        if (key.ctrl && input === 'p') {
            if (state.isLoading || state.pendingPermission)
                return;
            setPaletteOpen(prev => !prev);
            setPaletteQuery('');
            setPaletteIndex(0);
            return;
        }
        if (paletteOpen) {
            if (key.escape) {
                setPaletteOpen(false);
                setPaletteQuery('');
                setPaletteIndex(0);
                return;
            }
            if (key.upArrow) {
                setPaletteIndex(i => Math.max(0, i - 1));
                return;
            }
            if (key.downArrow) {
                setPaletteIndex(i => Math.min(Math.max(0, paletteItems.length - 1), i + 1));
                return;
            }
        }
        if (!paletteOpen && !state.isLoading && !state.pendingPermission) {
            if (key.tab || input === '\t') {
                const v = inputValue;
                if (!v.startsWith('/') || v.includes(' '))
                    return;
                if (slashSuggestions.length === 0)
                    return;
                const base = v.slice(1);
                const nextIndex = tabCycle.base === base
                    ? (tabCycle.index + 1) % slashSuggestions.length
                    : 0;
                setTabCycle({ base, index: nextIndex });
                const picked = slashSuggestions[nextIndex];
                setInputValue(`/${picked.name} `);
                setHistoryIndex(-1);
                return;
            }
        }
        if (key.upArrow && !state.isLoading) {
            const newIdx = Math.min(historyIndex + 1, inputHistory.length - 1);
            if (newIdx >= 0) {
                setHistoryIndex(newIdx);
                setInputValue(inputHistory[inputHistory.length - 1 - newIdx] ?? '');
            }
            return;
        }
        if (key.downArrow && !state.isLoading) {
            const newIdx = historyIndex - 1;
            if (newIdx < 0) {
                setHistoryIndex(-1);
                setInputValue('');
            }
            else {
                setHistoryIndex(newIdx);
                setInputValue(inputHistory[inputHistory.length - 1 - newIdx] ?? '');
            }
            return;
        }
    });
    const executeSlashCommand = useCallback(async (name, args) => {
        const cur = stateRef.current;
        const cmd = getAllSlashCommands(cur.cwd).find(c => c.name.toLowerCase() === name.toLowerCase());
        if (!cmd)
            return;
        try {
            const result = await cmd.execute(args, cur, setState);
            if (result) {
                setState(prev => ({
                    ...prev,
                    messages: [...prev.messages, { id: randomUUID(), role: 'assistant', content: result, timestamp: Date.now() }],
                }));
            }
        }
        catch (err) {
            setState(prev => ({ ...prev, error: err.message }));
        }
    }, []);
    // ── Submit ─────────────────────────────────────────────────
    const handleSubmit = useCallback(async (value) => {
        const trimmed = value.trim();
        if (!trimmed)
            return;
        if (state.pendingPermission) {
            // If we are waiting for permission, intercept input to resolve it
            const input = trimmed.toLowerCase();
            if (input === 'y') {
                state.pendingPermission.resolve('allow_once');
            }
            else if (input === 'n') {
                state.pendingPermission.resolve('deny');
            }
            else if (input === 'a') {
                state.pendingPermission.resolve('always_allow');
            }
            else {
                // Default to deny if invalid input when expecting permission
                state.pendingPermission.resolve('deny');
            }
            setInputValue('');
            return;
        }
        if (state.isLoading)
            return;
        setInputValue('');
        setHistoryIndex(-1);
        setInputHistory(prev => [...prev.slice(-99), trimmed]);
        // Slash command?
        const slashMatch = findSlashCommand(trimmed, state.cwd);
        if (slashMatch) {
            try {
                const args = trimmed.slice(slashMatch.command.name.length + 1).trim();
                const result = await slashMatch.command.execute(args, state, setState);
                if (result) {
                    setState(prev => ({
                        ...prev,
                        messages: [...prev.messages, { id: randomUUID(), role: 'assistant', content: result, timestamp: Date.now() }],
                    }));
                }
            }
            catch (err) {
                setState(prev => ({ ...prev, error: err.message }));
            }
            return;
        }
        const userMsg = { id: randomUUID(), role: 'user', content: trimmed, timestamp: Date.now() };
        setState(prev => ({ ...prev, messages: [...prev.messages, userMsg], isLoading: true, error: null }));
        setStreamingText('');
        setSpinnerText('thinking...');
        const abort = new AbortController();
        abortRef.current = abort;
        try {
            const { messages: newMsgs, inputTokens, outputTokens } = await runQuery({
                messages: [...state.messages, userMsg],
                model: state.model,
                cwd: state.cwd,
                permissionMode: state.permissionMode,
                planApproved: state.planApproved,
                providerConfig: state.providerConfig,
                apiKeyOverride,
                signal: abort.signal,
                onPermissionRequest: async (toolName, description) => {
                    if (state.permissionMode === 'auto')
                        return 'always_allow';
                    return new Promise((resolve) => {
                        const pending = {
                            id: randomUUID(), toolName, description,
                            resolve: (approved) => {
                                setState(prev => ({ ...prev, pendingPermission: null }));
                                resolve(approved);
                            },
                        };
                        setState(prev => ({ ...prev, pendingPermission: pending }));
                    });
                },
                onStreamChunk: (chunk) => {
                    if (chunk.type === 'text_delta') {
                        setStreamingText(prev => prev + (chunk.text ?? ''));
                    }
                    else if (chunk.type === 'tool_start') {
                        const name = chunk.toolName ?? '';
                        setSpinnerText(name && name !== '…' ? `${name}…` : 'thinking...');
                        setStreamingText('');
                    }
                    else if (chunk.type === 'tool_done') {
                        setSpinnerText('thinking...');
                    }
                    else if (chunk.type === 'error') {
                        setState(prev => ({ ...prev, error: chunk.error ?? 'Unknown error', isLoading: false }));
                        setSpinnerText('');
                        setStreamingText('');
                    }
                },
            });
            setState(prev => {
                const combined = [...prev.messages, ...newMsgs];
                const updated = {
                    ...prev,
                    messages: combined,
                    isLoading: false,
                    inputTokens: prev.inputTokens + inputTokens,
                    outputTokens: prev.outputTokens + outputTokens,
                    pendingPermission: null,
                    spinnerText: '',
                };
                saveSession({
                    id: prev.sessionId,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                    cwd: prev.cwd,
                    model: prev.model,
                    messages: combined,
                    inputTokens: updated.inputTokens,
                    outputTokens: updated.outputTokens,
                }).catch(() => { });
                return updated;
            });
        }
        catch (err) {
            const e = err;
            if (e.name !== 'AbortError') {
                setState(prev => ({ ...prev, isLoading: false, error: e.message, pendingPermission: null }));
            }
            else {
                setState(prev => ({ ...prev, isLoading: false, pendingPermission: null }));
            }
        }
        setStreamingText('');
        setSpinnerText('');
    }, [state, apiKeyOverride, streamingText]);
    // ── Render ─────────────────────────────────────────────────
    const visibleMessages = state.messages.filter(m => m.role !== 'system' || m.content.toString().startsWith('[Conversation'));
    const hasInstructions = !!loadProjectInstructions(state.cwd);
    return (React.createElement(Box, { flexDirection: "column", width: "100%" },
        React.createElement(Box, { flexDirection: "column", flexGrow: 1, paddingX: 1 },
            visibleMessages.length === 0 && (React.createElement(Box, { flexDirection: "column", paddingY: 1 },
                React.createElement(Text, { color: "cyan", bold: true }, '  ██████╗ ██╗   ██╗ █████╗ ███╗   ██╗ ██████╗ '),
                React.createElement(Text, { color: "cyan", bold: true }, '  ██╔════╝ ██║   ██║██╔══██╗████╗  ██║██╔════╝ '),
                React.createElement(Text, { color: "cyan", bold: true }, '  ██║  ███╗██║   ██║███████║██╔██╗ ██║██║  ███╗'),
                React.createElement(Text, { color: "cyan", bold: true }, '  ██║   ██║██║   ██║██╔══██║██║╚██╗██║██║   ██║'),
                React.createElement(Text, { color: "cyan", bold: true }, '  ╚██████╔╝╚██████╔╝██║  ██║██║ ╚████║╚██████╔╝'),
                React.createElement(Text, { color: "cyan", bold: true }, '   ╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═══╝ ╚═════╝ '),
                React.createElement(Text, { color: "cyan", bold: true }, '               CODE  ✦'),
                React.createElement(Text, null, " "),
                React.createElement(Text, { color: "gray" },
                    "  Your AI coding assistant. Type ",
                    React.createElement(Text, { color: "white" }, "a task"),
                    " to get started."),
                React.createElement(Text, { color: "gray" },
                    "  Type ",
                    React.createElement(Text, { color: "white" }, "/help"),
                    " for commands \u00B7 ",
                    React.createElement(Text, { color: "white" }, "/keys"),
                    " to manage API keys \u00B7 ",
                    React.createElement(Text, { color: "white" }, "/providers"),
                    " to see models"),
                hasInstructions && (React.createElement(Text, { color: "green", dimColor: true },
                    "  ",
                    figures.tick,
                    " Loaded instructions (CLAUDE.md/.claude/rules/)")),
                React.createElement(Text, null, " "))),
            visibleMessages.map(msg => React.createElement(MessageView, { key: msg.id, message: msg })),
            state.isLoading && streamingText && (React.createElement(Box, { flexDirection: "column", marginBottom: 1 },
                React.createElement(Text, { color: "cyan", bold: true },
                    figures.square,
                    " Guang Code"),
                React.createElement(Box, { paddingLeft: 2, flexDirection: "column" },
                    React.createElement(Text, null, streamingText),
                    React.createElement(Text, { color: "cyan", dimColor: true }, "\u258C")))),
            state.isLoading && !streamingText && (React.createElement(Box, { marginBottom: 1 },
                React.createElement(Spinner, { text: spinnerText })))),
        state.pendingPermission && React.createElement(PermissionRequest, { permission: state.pendingPermission }),
        state.error && (React.createElement(Box, { paddingX: 1, marginBottom: 1 },
            React.createElement(Text, { color: "red" },
                figures.cross,
                " ",
                state.error))),
        React.createElement(StatusBar, { state: state }),
        !state.isLoading && !paletteOpen && slashSuggestions.length > 0 && (React.createElement(Box, { paddingX: 1, flexDirection: "column", marginBottom: 1 },
            React.createElement(Text, { color: "gray", dimColor: true }, "Tab to complete \u00B7 Ctrl+P command palette"),
            slashSuggestions.map((s, i) => (React.createElement(Text, { key: s.name, color: i === 0 ? 'cyan' : 'gray', dimColor: true }, `/${s.name}  ${s.description ?? ''}`))))),
        paletteOpen && (React.createElement(Box, { paddingX: 1, flexDirection: "column", marginBottom: 1, borderStyle: "round", borderColor: "cyan" },
            React.createElement(Text, { color: "cyan", bold: true }, "Command Palette"),
            React.createElement(Box, null,
                React.createElement(Text, { color: "gray" },
                    figures.pointer,
                    " "),
                React.createElement(TextInput, { value: paletteQuery, onChange: (v) => { setPaletteQuery(v); setPaletteIndex(0); }, onSubmit: () => {
                        const picked = paletteItems[paletteIndex];
                        if (!picked)
                            return;
                        setPaletteOpen(false);
                        setPaletteQuery('');
                        setPaletteIndex(0);
                        if (picked.noArgs) {
                            executeSlashCommand(picked.name, '');
                        }
                        else {
                            setInputValue(`/${picked.name} `);
                        }
                    }, placeholder: "Type to search commands\u2026" })),
            React.createElement(Box, { flexDirection: "column", marginTop: 1 }, paletteItems.length === 0 ? (React.createElement(Text, { color: "gray", dimColor: true }, "No matches")) : (paletteItems.map((it, idx) => (React.createElement(Text, { key: it.name, color: idx === paletteIndex ? 'black' : 'white', backgroundColor: idx === paletteIndex ? 'cyan' : undefined }, `/${it.name}  ${it.description ?? ''}`))))),
            paletteItems[paletteIndex] && (React.createElement(Box, { flexDirection: "column", marginTop: 1 },
                React.createElement(Text, { color: "gray", dimColor: true },
                    "Usage: ",
                    (paletteItems[paletteIndex].usage ?? `/${paletteItems[paletteIndex].name}${paletteItems[paletteIndex].noArgs ? '' : ' …'}`)),
                (paletteItems[paletteIndex].examples ?? []).slice(0, 3).map((ex, i) => (React.createElement(Text, { key: i, color: "gray", dimColor: true }, `Example: ${ex.trim()}`))))),
            React.createElement(Text, { color: "gray", dimColor: true }, paletteItems[paletteIndex]?.noArgs ? 'Enter to run · Esc to close · ↑↓ to navigate' : 'Enter to insert · Esc to close · ↑↓ to navigate'))),
        React.createElement(Box, { paddingX: 1 },
            React.createElement(Text, { color: "green", bold: true }, state.permissionMode === 'plan' ? '📋 ' : `${figures.pointer} `),
            state.isLoading ? (React.createElement(Text, { color: "gray", dimColor: true }, "Press Ctrl+C to cancel\u2026")) : (!paletteOpen && React.createElement(TextInput, { value: inputValue, onChange: setInputValue, onSubmit: handleSubmit, placeholder: "Ask Guang Code anything\u2026" }))),
        !state.isLoading && !paletteOpen && activeSlashHelp && inputValue.startsWith('/') && (React.createElement(Box, { paddingX: 1, flexDirection: "column" },
            React.createElement(Text, { color: "gray", dimColor: true }, `Usage: ${activeSlashHelp.usage}`),
            activeSlashHelp.examples.slice(0, 2).map((ex, i) => (React.createElement(Text, { key: i, color: "gray", dimColor: true }, `Example: ${ex.trim()}`)))))));
}
