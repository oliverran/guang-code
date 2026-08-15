import type { PermissionMode, PermissionRule } from '../types/index.js';
export type PermissionDecision = 'allow' | 'deny' | 'ask';
export type PermissionDecisionResult = {
    decision: PermissionDecision;
    reason?: string;
    rule?: PermissionRule;
};
export declare function loadProjectPermissionRules(cwd: string): PermissionRule[];
export declare function decidePermission(opts: {
    permissionMode: PermissionMode;
    rules: PermissionRule[];
    toolName: string;
    toolInput?: Record<string, unknown>;
    cwd: string;
    planApproved?: boolean;
}): PermissionDecisionResult;
