export declare function parseTokenBudget(text: string): number | null;
export declare function findTokenBudgetPositions(text: string): Array<{
    start: number;
    end: number;
}>;
export declare function getBudgetContinuationMessage(pct: number, turnTokens: number, budget: number): string;
