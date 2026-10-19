// ============================================================
//  Guang Code — GlobTool
// ============================================================
import { glob } from '../../scripts/glob-shim.mjs';
import { validateGlobPattern } from '../utils/pathSafety.js';
export const GlobTool = {
    name: 'Glob',
    description: 'Find files matching a glob pattern (e.g. "**/*.ts", "src/**/*.{js,ts}", "*.json"). Returns a list of matching file paths sorted by modification time.',
    inputSchema: {
        type: 'object',
        properties: {
            pattern: {
                type: 'string',
                description: 'Glob pattern to match (e.g. "**/*.ts")',
            },
            ignore: {
                type: 'string',
                description: 'Comma-separated glob patterns to ignore (e.g. "node_modules/**,dist/**")',
            },
        },
        required: ['pattern'],
    },
    async execute(input, ctx) {
        const pattern = input.pattern;
        const ignoreRaw = input.ignore;
        const v = validateGlobPattern(pattern);
        if (!v.ok)
            return { content: `Glob error: ${v.reason ?? 'Invalid pattern.'}`, isError: true };
        const ignorePatterns = ignoreRaw
            ? ignoreRaw.split(',').map(p => p.trim()).filter(Boolean)
            : ['node_modules/**', 'dist/**', '.git/**', '*.min.js'];
        try {
            const matches = await glob(pattern, {
                cwd: ctx.cwd,
                ignore: ignorePatterns,
                absolute: false,
                dot: false,
            });
            if (matches.length === 0) {
                return { content: `No files matched pattern: ${pattern}` };
            }
            matches.sort();
            const result = matches.join('\n');
            return { content: `Found ${matches.length} file(s):\n${result}` };
        }
        catch (err) {
            const e = err;
            return { content: `Glob error: ${e.message}`, isError: true };
        }
    },
};
