import fs from 'fs';
import path from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import { cronMatches, minuteBucket } from './cron.js';
const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 200;
const LEASE_MS = 5 * 60_000;
const MAX_CATCHUP_MINUTES = 180;
const MAX_CLAIM_PER_TICK = 10;
function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}
function safeReadJson(filePath) {
    try {
        if (!fs.existsSync(filePath))
            return null;
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.tasks))
            return { tasks: [] };
        return { tasks: parsed.tasks.filter(Boolean) };
    }
    catch {
        return { tasks: [] };
    }
}
function writeJsonAtomic(filePath, data) {
    ensureDir(path.dirname(filePath));
    const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    const content = JSON.stringify(data, null, 2);
    fs.writeFileSync(tmp, content, 'utf-8');
    try {
        fs.renameSync(tmp, filePath);
    }
    catch (err) {
        const e = err;
        if (e.code === 'EEXIST' || e.code === 'EPERM') {
            try {
                fs.unlinkSync(filePath);
            }
            catch { }
            fs.renameSync(tmp, filePath);
        }
        else {
            try {
                fs.unlinkSync(tmp);
            }
            catch { }
            throw err;
        }
    }
}
function writeTasksFile(filePath, data) {
    writeJsonAtomic(filePath, data);
}
export function getProjectCronLockPath(cwd) {
    return path.join(cwd, '.guang', 'scheduled_tasks.lock');
}
export function getProjectCronStateFilePath(cwd) {
    return path.join(cwd, '.guang', 'scheduled_tasks.state.json');
}
function sleepMs(ms) {
    try {
        const sab = new SharedArrayBuffer(4);
        const ia = new Int32Array(sab);
        Atomics.wait(ia, 0, 0, ms);
    }
    catch {
        const end = Date.now() + ms;
        while (Date.now() < end) { }
    }
}
function acquireLock(lockPath) {
    ensureDir(path.dirname(lockPath));
    const deadline = Date.now() + LOCK_WAIT_MS;
    while (Date.now() < deadline) {
        try {
            const fd = fs.openSync(lockPath, 'wx');
            try {
                fs.writeFileSync(fd, `${process.pid} ${Date.now()}\n`, 'utf-8');
            }
            catch { }
            return { fd };
        }
        catch (err) {
            const e = err;
            if (e.code !== 'EEXIST')
                return null;
            try {
                const st = fs.statSync(lockPath);
                if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
                    try {
                        fs.unlinkSync(lockPath);
                    }
                    catch { }
                    continue;
                }
            }
            catch {
                continue;
            }
            sleepMs(20);
        }
    }
    return null;
}
function releaseLock(lockPath, fd) {
    try {
        fs.closeSync(fd);
    }
    catch { }
    try {
        fs.unlinkSync(lockPath);
    }
    catch { }
}
function withProjectCronLock(cwd, fn) {
    const lockPath = getProjectCronLockPath(cwd);
    const lock = acquireLock(lockPath);
    if (!lock)
        return null;
    try {
        return fn();
    }
    finally {
        releaseLock(lockPath, lock.fd);
    }
}
function safeReadState(filePath) {
    try {
        if (!fs.existsSync(filePath))
            return { version: 1, leases: [], lastFired: {} };
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        const leases = Array.isArray(parsed.leases) ? parsed.leases.filter(Boolean) : [];
        const lastFired = parsed.lastFired && typeof parsed.lastFired === 'object' ? parsed.lastFired : {};
        return { version: 1, lastCheckedAt: parsed.lastCheckedAt, leases, lastFired };
    }
    catch {
        return { version: 1, leases: [], lastFired: {} };
    }
}
function writeState(filePath, state) {
    writeJsonAtomic(filePath, state);
}
export function getProjectCronFilePath(cwd) {
    return path.join(cwd, '.guang', 'scheduled_tasks.json');
}
export function getUserCronFilePath() {
    return path.join(homedir(), '.guang-code', 'scheduled_tasks.json');
}
export function loadCronTasks(cwd) {
    const user = safeReadJson(getUserCronFilePath())?.tasks ?? [];
    const project = safeReadJson(getProjectCronFilePath(cwd))?.tasks ?? [];
    return [...user, ...project]
        .filter(t => t && typeof t.cron === 'string' && typeof t.prompt === 'string')
        .map(t => ({ ...t, enabled: t.enabled !== false, recurring: t.recurring !== false }));
}
export function listProjectCronTasks(cwd) {
    return (safeReadJson(getProjectCronFilePath(cwd))?.tasks ?? [])
        .map(t => ({ ...t, enabled: t.enabled !== false, recurring: t.recurring !== false }));
}
export function addProjectCronTask(cwd, input) {
    const filePath = getProjectCronFilePath(cwd);
    const task = {
        id: randomUUID().slice(0, 8),
        cron: input.cron.trim(),
        prompt: input.prompt.trim(),
        createdAt: Date.now(),
        recurring: input.recurring !== false,
        enabled: input.enabled !== false,
    };
    const res = withProjectCronLock(cwd, () => {
        const data = safeReadJson(filePath) ?? { tasks: [] };
        data.tasks.push(task);
        writeTasksFile(filePath, data);
        return true;
    });
    if (!res)
        throw new Error('Could not acquire cron lock');
    return task;
}
export function setProjectCronTaskEnabled(cwd, id, enabled) {
    const filePath = getProjectCronFilePath(cwd);
    const res = withProjectCronLock(cwd, () => {
        const data = safeReadJson(filePath);
        if (!data)
            return { ok: false, error: 'No scheduled_tasks.json found in project' };
        let found = false;
        data.tasks = data.tasks.map(t => {
            if (t.id !== id)
                return t;
            found = true;
            return { ...t, enabled };
        });
        if (!found)
            return { ok: false, error: `Task not found: ${id}` };
        writeTasksFile(filePath, data);
        return { ok: true };
    });
    return res ?? { ok: false, error: 'Could not acquire cron lock' };
}
export function removeProjectCronTask(cwd, id) {
    const filePath = getProjectCronFilePath(cwd);
    const res = withProjectCronLock(cwd, () => {
        const data = safeReadJson(filePath);
        if (!data)
            return { ok: false, error: 'No scheduled_tasks.json found in project' };
        const before = data.tasks.length;
        data.tasks = data.tasks.filter(t => t.id !== id);
        if (data.tasks.length === before)
            return { ok: false, error: `Task not found: ${id}` };
        writeTasksFile(filePath, data);
        return { ok: true };
    });
    return res ?? { ok: false, error: 'Could not acquire cron lock' };
}
export function clearProjectCronTasks(cwd) {
    const filePath = getProjectCronFilePath(cwd);
    const res = withProjectCronLock(cwd, () => {
        writeTasksFile(filePath, { tasks: [] });
        return true;
    });
    if (!res)
        throw new Error('Could not acquire cron lock');
}
function cronMatchesAtMinute(task, bucketMs) {
    const d = new Date(bucketMs);
    return cronMatches(task.cron, d);
}
export function computeDueTasksCatchup(tasks, opts) {
    const nowBucket = minuteBucket(opts.now.getTime());
    const lastChecked = opts.lastCheckedAt ? minuteBucket(opts.lastCheckedAt) : nowBucket;
    const start = Math.min(lastChecked, nowBucket);
    const end = Math.max(lastChecked, nowBucket);
    const due = [];
    let updated = tasks.slice();
    const buckets = [];
    for (let t = start; t <= end; t += 60_000)
        buckets.push(t);
    for (const bucket of buckets) {
        const nextUpdated = [];
        for (const t of updated) {
            const enabled = t.enabled !== false;
            const recurring = t.recurring !== false;
            if (!enabled) {
                nextUpdated.push(t);
                continue;
            }
            const last = t.lastFiredAt ? minuteBucket(t.lastFiredAt) : 0;
            if (last === bucket) {
                nextUpdated.push(t);
                continue;
            }
            if (!cronMatchesAtMinute(t, bucket)) {
                nextUpdated.push(t);
                continue;
            }
            due.push({ ...t, lastFiredAt: bucket });
            if (recurring)
                nextUpdated.push({ ...t, lastFiredAt: bucket });
        }
        updated = nextUpdated;
    }
    const dedupDue = new Map();
    for (const t of due) {
        const key = `${t.id}:${t.lastFiredAt ?? 0}`;
        if (!dedupDue.has(key))
            dedupDue.set(key, t);
    }
    return { due: Array.from(dedupDue.values()), updated, checkedAt: nowBucket };
}
export function updateProjectCronTasks(cwd, tasks) {
    const filePath = getProjectCronFilePath(cwd);
    const res = withProjectCronLock(cwd, () => {
        const existing = safeReadJson(filePath);
        if (!existing && tasks.length === 0)
            return true;
        const projectIds = new Set((existing?.tasks ?? []).map(t => t.id));
        const merged = [];
        for (const t of tasks) {
            if (projectIds.has(t.id))
                merged.push(t);
        }
        writeTasksFile(filePath, { tasks: merged });
        return true;
    });
    if (!res)
        throw new Error('Could not acquire cron lock');
}
export function claimDueProjectCronRuns(cwd, now) {
    const filePath = getProjectCronFilePath(cwd);
    const statePath = getProjectCronStateFilePath(cwd);
    const nowBucket = minuteBucket(now.getTime());
    const res = withProjectCronLock(cwd, () => {
        const tasks = (safeReadJson(filePath)?.tasks ?? [])
            .filter(t => t && typeof t.cron === 'string' && typeof t.prompt === 'string')
            .map(t => ({ ...t, enabled: t.enabled !== false, recurring: t.recurring !== false }));
        const state = safeReadState(statePath);
        const nowMs = Date.now();
        const leases = (state.leases || []).filter(l => l && typeof l.leaseUntil === 'number' && l.leaseUntil > nowMs);
        state.leases = leases;
        const lastChecked = state.lastCheckedAt ? minuteBucket(state.lastCheckedAt) : nowBucket;
        const minStart = nowBucket - MAX_CATCHUP_MINUTES * 60_000;
        const start = Math.max(Math.min(lastChecked, nowBucket), minStart);
        const end = Math.max(lastChecked, nowBucket);
        const runs = [];
        for (let bucket = start; bucket <= end; bucket += 60_000) {
            for (const t of tasks) {
                if (t.enabled === false)
                    continue;
                const lastA = t.lastFiredAt ? minuteBucket(t.lastFiredAt) : 0;
                const lastB = state.lastFired[t.id] ? minuteBucket(state.lastFired[t.id]) : 0;
                const last = Math.max(lastA, lastB);
                if (last >= bucket)
                    continue;
                if (!cronMatchesAtMinute(t, bucket))
                    continue;
                const alreadyLeased = state.leases.some(l => l.id === t.id && l.bucket === bucket);
                if (alreadyLeased)
                    continue;
                state.leases.push({ id: t.id, bucket, leaseUntil: nowMs + LEASE_MS, createdAt: nowMs });
                runs.push({ task: t, bucket });
                if (runs.length >= MAX_CLAIM_PER_TICK)
                    break;
            }
            if (runs.length >= MAX_CLAIM_PER_TICK)
                break;
        }
        state.lastCheckedAt = nowBucket;
        writeState(statePath, state);
        return { runs, claimedAt: nowBucket };
    });
    return res ?? { runs: [], claimedAt: nowBucket };
}
export function finalizeProjectCronRun(cwd, run, success) {
    const filePath = getProjectCronFilePath(cwd);
    const statePath = getProjectCronStateFilePath(cwd);
    const bucket = minuteBucket(run.bucket);
    withProjectCronLock(cwd, () => {
        const data = safeReadJson(filePath) ?? { tasks: [] };
        const state = safeReadState(statePath);
        state.leases = (state.leases || []).filter(l => !(l.id === run.task.id && l.bucket === bucket));
        if (success) {
            state.lastFired[run.task.id] = bucket;
            data.tasks = data.tasks
                .map(t => {
                if (t.id !== run.task.id)
                    return t;
                return { ...t, lastFiredAt: bucket };
            })
                .filter(t => {
                if (t.id !== run.task.id)
                    return true;
                const recurring = t.recurring !== false;
                return recurring;
            });
        }
        writeState(statePath, state);
        writeTasksFile(filePath, data);
        return true;
    });
}
