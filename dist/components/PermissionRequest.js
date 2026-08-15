// ============================================================
//  Guang Code — Permission Request Component
// ============================================================
import React from 'react';
import { Box, Text, useInput } from 'ink';
import figures from 'figures';
export function PermissionRequest({ permission }) {
    useInput((input, key) => {
        if (input === 'y' || input === 'Y' || key.return) {
            permission.resolve('allow_once');
        }
        else if (input === 'n' || input === 'N' || key.escape) {
            permission.resolve('deny');
        }
        else if (input === 'a' || input === 'A') {
            permission.resolve('always_allow');
        }
    });
    const lines = permission.description.split('\n');
    return (React.createElement(Box, { flexDirection: "column", borderStyle: "round", borderColor: "yellow", paddingX: 2, paddingY: 1, marginY: 1 },
        React.createElement(Text, { color: "yellow", bold: true },
            figures.warning,
            "  Permission Request"),
        React.createElement(Text, { color: "yellow", bold: true },
            "Tool: ",
            permission.toolName),
        React.createElement(Box, { marginY: 1, flexDirection: "column" }, lines.map((line, i) => (React.createElement(Text, { key: i, color: "gray" }, line)))),
        React.createElement(Box, null,
            React.createElement(Text, { color: "green", bold: true },
                "[Y/",
                figures.tick,
                "] "),
            React.createElement(Text, { color: "green" }, "Allow Once  "),
            React.createElement(Text, { color: "cyan", bold: true }, "[A] "),
            React.createElement(Text, { color: "cyan" }, "Always Allow  "),
            React.createElement(Text, { color: "red", bold: true },
                "[N/",
                figures.cross,
                "] "),
            React.createElement(Text, { color: "red" }, "Deny"))));
}
