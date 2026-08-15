export type PmIngestedFile = {
    path: string;
    sha256: string;
    mtimeMs: number;
    size: number;
    excerpt: string;
};
export type PmContext = {
    version: 1;
    updatedAt: number;
    files: PmIngestedFile[];
};
export declare function loadPmContext(cwd: string): Promise<PmContext>;
export declare function savePmContext(cwd: string, ctx: PmContext): Promise<void>;
export declare function clearPmContext(cwd: string): Promise<void>;
export declare function ingestPmFiles(opts: {
    cwd: string;
    patternsOrPaths: string[];
    ignore?: string[];
    maxFiles?: number;
}): Promise<{
    added: number;
    skipped: number;
    total: number;
}>;
export declare function renderPmContextForPrompt(ctx: PmContext, maxChars?: number): string;
