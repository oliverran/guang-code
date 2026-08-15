export type BudgetTracker = {
    continuationCount: number;
    lastDeltaTokens: number;
    lastGlobalTurnTokens: number;
    startedAt: number;
};
export declare function createBudgetTracker(): BudgetTracker;
type ContinueDecision = {
    action: 'continue';
    nudgeMessage: string;
    continuationCount: number;
    pct: number;
    turnTokens: number;
    budget: number;
};
type StopDecision = {
    action: 'stop';
    completionEvent: {
        continuationCount: number;
        pct: number;
        turnTokens: number;
        budget: number;
        diminishingReturns: boolean;
        durationMs: number;
    } | null;
};
export type TokenBudgetDecision = ContinueDecision | StopDecision;
export declare function checkTokenBudget(tracker: BudgetTracker, agentId: string | undefined, budget: number | null, globalTurnTokens: number): TokenBudgetDecision;
export {};
