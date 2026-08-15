export declare function isUncPath(p: string): boolean;
export declare function resolveAgainstCwd(cwd: string, p: string): string;
export declare function isPathWithin(baseDir: string, targetPath: string): boolean;
export declare function isProtectedProjectFile(opts: {
    cwd: string;
    absPath: string;
}): boolean;
export declare function assertSafeLocalPath(opts: {
    cwd: string;
    inputPath: string;
    allowUnc?: boolean;
}): string;
export declare function validateGlobPattern(pattern: string): {
    ok: boolean;
    reason?: string;
};
export declare function resolveRealPathWithinCwd(opts: {
    cwd: string;
    absPath: string;
}): Promise<string>;
export declare function isLikelyTextFileExt(filePath: string): boolean;
export declare function isSymlinkSync(p: string): boolean;
