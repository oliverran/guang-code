export type MemoryEntryType = 'user' | 'project' | 'reference' | 'feedback';
export type MemoryEntry = {
    id: string;
    type: MemoryEntryType;
    name: string;
    description: string;
    filePath: string;
    createdAt: number;
};
export declare const ENTRYPOINT_NAME = "MEMORY.md";
export declare const MAX_ENTRYPOINT_LINES = 200;
export declare const MAX_ENTRYPOINT_BYTES = 25000;
export type EntrypointTruncation = {
    content: string;
    lineCount: number;
    byteCount: number;
    wasLineTruncated: boolean;
    wasByteTruncated: boolean;
};
export declare const MEMORY_FRONTMATTER_EXAMPLE: string[];
export type MemoryOptions = {
    enabled?: boolean;
    baseDir?: string;
};
export declare function isAutoMemoryEnabled(opts?: MemoryOptions): boolean;
export declare function getProjectMemoryDir(cwd: string, opts?: {
    baseDir?: string;
}): string;
export declare function truncateEntrypointContent(raw: string): EntrypointTruncation;
export declare function ensureMemoryDirExists(cwd: string, opts?: MemoryOptions): string;
export declare function ensureMemoryIndexExists(cwd: string, opts?: MemoryOptions): {
    memoryDir: string;
    entrypoint: string;
};
export declare function loadMemoryForPrompt(cwd: string, opts?: MemoryOptions): {
    text: string;
    sources: string[];
    memoryDir: string;
} | null;
export declare function listMemoryEntries(cwd: string, opts?: MemoryOptions): MemoryEntry[];
export declare function addMemory(cwd: string, opts: {
    type: MemoryEntryType;
    name?: string;
    description?: string;
    body: string;
} & {
    baseDir?: string;
}): MemoryEntry;
export declare function removeMemory(cwd: string, id: string, opts?: MemoryOptions): {
    ok: boolean;
    error?: string;
};
export declare function readMemoryFile(cwd: string, id: string, opts?: MemoryOptions): string | null;
