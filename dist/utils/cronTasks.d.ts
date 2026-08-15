export type CronTask = {
    id: string;
    cron: string;
    prompt: string;
    createdAt: number;
    lastFiredAt?: number;
    recurring?: boolean;
    enabled?: boolean;
};
export type CronTasksFile = {
    tasks: CronTask[];
};
export type CronLease = {
    id: string;
    bucket: number;
    leaseUntil: number;
    createdAt: number;
};
export type CronRuntimeState = {
    version: 1;
    lastCheckedAt?: number;
    leases: CronLease[];
    lastFired: Record<string, number>;
};
export type CronTaskRun = {
    task: CronTask;
    bucket: number;
};
export declare function getProjectCronLockPath(cwd: string): string;
export declare function getProjectCronStateFilePath(cwd: string): string;
export declare function getProjectCronFilePath(cwd: string): string;
export declare function getUserCronFilePath(): string;
export declare function loadCronTasks(cwd: string): CronTask[];
export declare function listProjectCronTasks(cwd: string): CronTask[];
export declare function addProjectCronTask(cwd: string, input: {
    cron: string;
    prompt: string;
    recurring?: boolean;
    enabled?: boolean;
}): CronTask;
export declare function setProjectCronTaskEnabled(cwd: string, id: string, enabled: boolean): {
    ok: boolean;
    error?: string;
};
export declare function removeProjectCronTask(cwd: string, id: string): {
    ok: boolean;
    error?: string;
};
export declare function clearProjectCronTasks(cwd: string): void;
export declare function computeDueTasksCatchup(tasks: CronTask[], opts: {
    now: Date;
    lastCheckedAt?: number;
}): {
    due: CronTask[];
    updated: CronTask[];
    checkedAt: number;
};
export declare function updateProjectCronTasks(cwd: string, tasks: CronTask[]): void;
export declare function claimDueProjectCronRuns(cwd: string, now: Date): {
    runs: CronTaskRun[];
    claimedAt: number;
};
export declare function finalizeProjectCronRun(cwd: string, run: CronTaskRun, success: boolean): void;
