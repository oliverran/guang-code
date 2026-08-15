/**
 * Common Git utilities for Guang Code
 */
export declare function isGitRepo(cwd: string): Promise<boolean>;
export declare function getGitStatus(cwd: string): Promise<string>;
export declare function getGitDiff(cwd: string): Promise<string>;
export declare function getCurrentBranch(cwd: string): Promise<string>;
