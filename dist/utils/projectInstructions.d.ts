/**
 * Searches for project instruction files in the given directory.
 * Looks for GUANG.md first, then falls back to CLAUDE.md.
 *
 * @param cwd The directory to search in
 * @returns The content of the instruction file, or null if not found
 */
export declare function loadProjectInstructions(cwd: string): string | null;
