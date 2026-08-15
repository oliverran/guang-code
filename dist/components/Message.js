// ============================================================
//  Guang Code — Message Component
// ============================================================
import React from 'react';
import { Box, Text } from 'ink';
import figures from 'figures';
import { renderMarkdown } from '../utils/markdown/index.js';
function formatTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
export function MessageView({ message, showTimestamp = false }) {
    const content = typeof message.content === 'string'
        ? message.content
        : JSON.stringify(message.content);
    // Tool interaction messages (dimmed)
    const isToolMsg = message.toolUseId !== undefined;
    if (isToolMsg) {
        const isInput = content.startsWith('[Tool:');
        return (React.createElement(Box, { flexDirection: "column", marginBottom: 0 },
            React.createElement(Text, { color: "gray", dimColor: true },
                content.split('\n').slice(0, 3).join('\n'),
                content.split('\n').length > 3 ? '\n...' : '')));
    }
    // System messages
    if (message.role === 'system') {
        return (React.createElement(Box, { marginBottom: 1, paddingX: 1, borderStyle: "round", borderColor: "yellow" },
            React.createElement(Text, { color: "yellow", dimColor: true }, content)));
    }
    // User messages
    if (message.role === 'user') {
        return (React.createElement(Box, { flexDirection: "column", marginBottom: 1 },
            React.createElement(Box, null,
                React.createElement(Text, { color: "green", bold: true },
                    figures.play,
                    " You"),
                showTimestamp && (React.createElement(Text, { color: "gray", dimColor: true },
                    "  ",
                    formatTime(message.timestamp)))),
            React.createElement(Box, { paddingLeft: 2 },
                React.createElement(Text, null, content))));
    }
    // Assistant messages — render with basic markdown-like formatting
    if (message.role === 'assistant') {
        return (React.createElement(Box, { flexDirection: "column", marginBottom: 1 },
            React.createElement(Box, null,
                React.createElement(Text, { color: "cyan", bold: true },
                    figures.square,
                    " Guang Code"),
                showTimestamp && (React.createElement(Text, { color: "gray", dimColor: true },
                    "  ",
                    formatTime(message.timestamp)))),
            React.createElement(Box, { paddingLeft: 2, flexDirection: "column" },
                React.createElement(AssistantText, { text: content }))));
    }
    return null;
}
// Simple assistant text renderer with code block detection
function AssistantText({ text }) {
    // Use our new robust markdown renderer
    return (React.createElement(Box, { flexDirection: "column" },
        React.createElement(Text, null, renderMarkdown(text))));
}
