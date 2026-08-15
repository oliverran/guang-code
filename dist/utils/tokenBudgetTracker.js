// ============================================================
//  Guang Code — Token Budget Tracker
// ============================================================
import { getBudgetContinuationMessage } from './tokenBudget.js';
const COMPLETION_THRESHOLD = 0.9;
const DIMINISHING_THRESHOLD = 500;
export function createBudgetTracker() {
    return {
        continuationCount: 0,
        lastDeltaTokens: 0,
        lastGlobalTurnTokens: 0,
        startedAt: Date.now(),
    };
}
export function checkTokenBudget(tracker, agentId, budget, globalTurnTokens) {
    if (agentId || budget === null || budget <= 0) {
        return { action: 'stop', completionEvent: null };
    }
    const turnTokens = globalTurnTokens;
    const pct = Math.round((turnTokens / budget) * 100);
    const deltaSinceLastCheck = globalTurnTokens - tracker.lastGlobalTurnTokens;
    const isDiminishing = tracker.continuationCount >= 3 &&
        deltaSinceLastCheck < DIMINISHING_THRESHOLD &&
        tracker.lastDeltaTokens < DIMINISHING_THRESHOLD;
    if (!isDiminishing && turnTokens < budget * COMPLETION_THRESHOLD) {
        tracker.continuationCount++;
        tracker.lastDeltaTokens = deltaSinceLastCheck;
        tracker.lastGlobalTurnTokens = globalTurnTokens;
        return {
            action: 'continue',
            nudgeMessage: getBudgetContinuationMessage(pct, turnTokens, budget),
            continuationCount: tracker.continuationCount,
            pct,
            turnTokens,
            budget,
        };
    }
    if (isDiminishing || tracker.continuationCount > 0) {
        return {
            action: 'stop',
            completionEvent: {
                continuationCount: tracker.continuationCount,
                pct,
                turnTokens,
                budget,
                diminishingReturns: isDiminishing,
                durationMs: Date.now() - tracker.startedAt,
            },
        };
    }
    return { action: 'stop', completionEvent: null };
}
