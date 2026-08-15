export type LoadedInstructions = {
    text: string;
    sources: string[];
};
export declare function loadAllInstructions(cwd: string): LoadedInstructions | null;
