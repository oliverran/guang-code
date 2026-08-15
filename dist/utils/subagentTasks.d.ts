export type TaskStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout';
export type TaskRecord = {
    id: string;
    name?: string;
    description: string;
    status: TaskStatus;
    createdAt: number;
    updatedAt: number;
    report?: string;
    error?: string;
    timeoutMs?: number;
    controller: AbortController;
    messageQueue: string[];
    params: Record<string, unknown>;
};
type TaskListener = (task: TaskRecord) => void;
declare class SubagentTaskRegistry {
    private tasks;
    private nameToId;
    private emitter;
    create(params: {
        name?: string;
        description: string;
        timeoutMs?: number;
        params: Record<string, unknown>;
    }): TaskRecord;
    list(): TaskRecord[];
    get(idOrName: string): TaskRecord | null;
    update(id: string, patch: Partial<TaskRecord>): void;
    enqueueMessage(idOrName: string, message: string): {
        ok: boolean;
        error?: string;
    };
    drainMessages(id: string): string[];
    cancel(idOrName: string): {
        ok: boolean;
        error?: string;
    };
    on(listener: TaskListener): () => void;
}
export declare const subagentTasks: SubagentTaskRegistry;
export {};
