import type { SlashCommand } from '../types/index.js';
export declare const FRONTMATTER_REGEX: RegExp;
export type FrontmatterData = {
    description?: string;
    'user-invocable'?: boolean;
    [key: string]: unknown;
};
export type ParsedMarkdown = {
    frontmatter: FrontmatterData;
    content: string;
};
export declare function parseFrontmatter(markdown: string): ParsedMarkdown;
export declare function loadCustomCommands(cwd: string): SlashCommand[];
