import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
class SubagentTaskRegistry {
    tasks = new Map();
    nameToId = new Map();
    emitter = new EventEmitter();
    create(params) {
        const id = randomUUID();
        const now = Date.now();
        const controller = new AbortController();
        const task = {
            id,
            name: params.name?.trim() || undefined,
            description: params.description,
            status: 'running',
            createdAt: now,
            updatedAt: now,
            timeoutMs: params.timeoutMs,
            controller,
            messageQueue: [],
            params: params.params,
        };
        this.tasks.set(id, task);
        if (task.name)
            this.nameToId.set(task.name, id);
        this.emitter.emit('task', task);
        return task;
    }
    list() {
        return Array.from(this.tasks.values()).sort((a, b) => b.createdAt - a.createdAt);
    }
    get(idOrName) {
        const key = idOrName.trim();
        const byId = this.tasks.get(key);
        if (byId)
            return byId;
        const id = this.nameToId.get(key);
        if (!id)
            return null;
        return this.tasks.get(id) ?? null;
    }
    update(id, patch) {
        const cur = this.tasks.get(id);
        if (!cur)
            return;
        const next = { ...cur, ...patch, updatedAt: Date.now() };
        this.tasks.set(id, next);
        if (next.name)
            this.nameToId.set(next.name, id);
        this.emitter.emit('task', next);
    }
    enqueueMessage(idOrName, message) {
        const task = this.get(idOrName);
        if (!task)
            return { ok: false, error: `Task not found: ${idOrName}` };
        if (task.status !== 'running')
            return { ok: false, error: `Task is not running: ${task.status}` };
        task.messageQueue.push(message);
        task.updatedAt = Date.now();
        this.emitter.emit('task', task);
        return { ok: true };
    }
    drainMessages(id) {
        const task = this.tasks.get(id);
        if (!task)
            return [];
        const msgs = task.messageQueue.splice(0, task.messageQueue.length);
        task.updatedAt = Date.now();
        this.emitter.emit('task', task);
        return msgs;
    }
    cancel(idOrName) {
        const task = this.get(idOrName);
        if (!task)
            return { ok: false, error: `Task not found: ${idOrName}` };
        if (task.status !== 'running')
            return { ok: false, error: `Task is not running: ${task.status}` };
        task.controller.abort();
        this.update(task.id, { status: 'cancelled' });
        return { ok: true };
    }
    on(listener) {
        this.emitter.on('task', listener);
        return () => this.emitter.off('task', listener);
    }
}
export const subagentTasks = new SubagentTaskRegistry();
