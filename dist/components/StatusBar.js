// ============================================================
//  Guang Code — Status Bar
// ============================================================
import React from 'react';
import { Box, Text, Spacer } from 'ink';
import { useState, useEffect } from 'react';
import figures from 'figures';
const MODE_COLORS = {
    default: 'cyan',
    auto: 'green',
    plan: 'yellow',
};
const MODE_ICONS = {
    default: figures.circleFilled,
    auto: '⚡',
    plan: '📋',
};
export function StatusBar({ state }) {
    const [columns, setColumns] = useState(process.stdout.columns ?? 80);
    useEffect(() => {
        const handler = () => setColumns(process.stdout.columns ?? 80);
        process.stdout.on('resize', handler);
        return () => { process.stdout.off('resize', handler); };
    }, []);
    const { model, permissionMode, inputTokens, outputTokens, cwd, isLoading } = state;
    const totalTokens = inputTokens + outputTokens;
    const tokenStr = totalTokens > 0 ? `${(totalTokens / 1000).toFixed(1)}k tokens` : '';
    const modeColor = MODE_COLORS[permissionMode] ?? 'white';
    const modeIcon = MODE_ICONS[permissionMode] ?? '●';
    // Shorten model name
    const shortModel = model
        .replace('claude-', '')
        .replace('-20241022', '')
        .replace('-20240229', '')
        .slice(0, 20);
    return (React.createElement(Box, { borderStyle: "single", borderTop: true, borderBottom: false, borderLeft: false, borderRight: false, borderColor: "gray", paddingX: 1, width: columns },
        React.createElement(Text, { color: "cyan", bold: true }, "GC "),
        React.createElement(Text, { color: "gray" }, "\u2502 "),
        React.createElement(Text, { color: "white" }, shortModel),
        React.createElement(Text, { color: "gray" }, " \u2502 "),
        React.createElement(Text, { color: modeColor },
            modeIcon,
            " ",
            permissionMode),
        React.createElement(Text, { color: "gray" }, " \u2502 "),
        React.createElement(Text, { color: "gray" }, shortenPath(cwd)),
        React.createElement(Spacer, null),
        React.createElement(Box, null,
            isLoading && React.createElement(Text, { color: "cyan" }, "\u27F3 thinking  "),
            tokenStr && React.createElement(Text, { color: "gray", dimColor: true }, tokenStr))));
}
function shortenPath(p) {
    const home = process.env.HOME ?? '/root';
    const rel = p.startsWith(home) ? '~' + p.slice(home.length) : p;
    if (rel.length <= 30)
        return rel;
    const parts = rel.split('/');
    if (parts.length <= 3)
        return rel;
    return `…/${parts.slice(-2).join('/')}`;
}
