import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'

export type TaskStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout'

export type TaskRecord = {
  id: string
  name?: string
  description: string
  status: TaskStatus
  createdAt: number
  updatedAt: number
  report?: string
  error?: string
  timeoutMs?: number
  controller: AbortController
  messageQueue: string[]
  params: Record<string, unknown>
}

type TaskListener = (task: TaskRecord) => void

class SubagentTaskRegistry {
  private tasks = new Map<string, TaskRecord>()
  private nameToId = new Map<string, string>()
  private emitter = new EventEmitter()

  create(params: {
    name?: string
    description: string
    timeoutMs?: number
    params: Record<string, unknown>
  }): TaskRecord {
    const id = randomUUID()
    const now = Date.now()
    const controller = new AbortController()

    const task: TaskRecord = {
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
    }

    this.tasks.set(id, task)
    if (task.name) this.nameToId.set(task.name, id)
    this.emitter.emit('task', task)
    return task
  }

  list(): TaskRecord[] {
    return Array.from(this.tasks.values()).sort((a, b) => b.createdAt - a.createdAt)
  }

  get(idOrName: string): TaskRecord | null {
    const key = idOrName.trim()
    const byId = this.tasks.get(key)
    if (byId) return byId
    const id = this.nameToId.get(key)
    if (!id) return null
    return this.tasks.get(id) ?? null
  }

  update(id: string, patch: Partial<TaskRecord>): void {
    const cur = this.tasks.get(id)
    if (!cur) return
    const next: TaskRecord = { ...cur, ...patch, updatedAt: Date.now() }
    this.tasks.set(id, next)
    if (next.name) this.nameToId.set(next.name, id)
    this.emitter.emit('task', next)
  }

  enqueueMessage(idOrName: string, message: string): { ok: boolean; error?: string } {
    const task = this.get(idOrName)
    if (!task) return { ok: false, error: `Task not found: ${idOrName}` }
    if (task.status !== 'running') return { ok: false, error: `Task is not running: ${task.status}` }
    task.messageQueue.push(message)
    task.updatedAt = Date.now()
    this.emitter.emit('task', task)
    return { ok: true }
  }

  drainMessages(id: string): string[] {
    const task = this.tasks.get(id)
    if (!task) return []
    const msgs = task.messageQueue.splice(0, task.messageQueue.length)
    task.updatedAt = Date.now()
    this.emitter.emit('task', task)
    return msgs
  }

  cancel(idOrName: string): { ok: boolean; error?: string } {
    const task = this.get(idOrName)
    if (!task) return { ok: false, error: `Task not found: ${idOrName}` }
    if (task.status !== 'running') return { ok: false, error: `Task is not running: ${task.status}` }
    task.controller.abort()
    this.update(task.id, { status: 'cancelled' })
    return { ok: true }
  }

  on(listener: TaskListener): () => void {
    this.emitter.on('task', listener)
    return () => this.emitter.off('task', listener)
  }
}

export const subagentTasks = new SubagentTaskRegistry()

