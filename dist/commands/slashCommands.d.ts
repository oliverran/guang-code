import type { SlashCommand } from '../types/index.js';
export declare const builtInSlashCommands: SlashCommand[];
export declare function getAllSlashCommands(cwd: string): SlashCommand[];
export declare function findSlashCommand(input: string, cwd?: string): {
    command: SlashCommand;
    args: string;
} | null;
