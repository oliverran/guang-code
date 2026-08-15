export type HookEvent = 'SessionStart' | 'PreToolUse' | 'PostToolUse' | 'SessionEnd';
export type HookConfig = {
    type: 'command';
    command: string;
    matcher?: string;
};
export type HooksSettings = Record<string, HookConfig[]>;
export declare class HooksManager {
    private hooks;
    loadHooks(cwd: string | null): Promise<void>;
    triggerEvent(event: HookEvent, cwd: string, context?: Record<string, unknown>): Promise<void>;
}
export declare const hooksManager: HooksManager;
