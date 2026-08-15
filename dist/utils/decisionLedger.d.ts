export type Decision = {
    id: string;
    createdAt: number;
    updatedAt: number;
    title: string;
    summary: string;
    rationale?: string;
    alternatives?: string[];
    owner?: string;
    due?: string;
    links?: string[];
    source?: {
        sessionId?: string;
    };
};
export type DecisionLedger = {
    version: 1;
    updatedAt: number;
    decisions: Decision[];
};
export declare function loadDecisionLedger(cwd: string): Promise<DecisionLedger>;
export declare function addDecision(cwd: string, input: Omit<Decision, 'id' | 'createdAt' | 'updatedAt'>): Promise<Decision>;
export declare function linkDecision(cwd: string, idPrefix: string, link: string): Promise<Decision | null>;
export declare function renderDecisionList(ledger: DecisionLedger, limit?: number): string;
export declare function renderDecisionForPrompt(ledger: DecisionLedger, maxChars?: number): string;
export declare function exportDecisionLedgerMarkdown(cwd: string, outPath: string): Promise<string>;
