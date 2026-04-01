import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'

export type SubagentEvent =
  | { type: 'started'; id: string; description: string }
  | { type: 'named'; id: string; name: string }
  | { type: 'progress'; id: string; message: string }
  | { type: 'completed'; id: string; report: string }
  | { type: 'failed'; id: string; error: string }

type Listener = (e: SubagentEvent) => void

const emitter = new EventEmitter()

export function onSubagentEvent(listener: Listener): () => void {
  emitter.on('event', listener)
  return () => emitter.off('event', listener)
}

export function emitSubagentEvent(e: SubagentEvent): void {
  emitter.emit('event', e)
}

export function createSubagentId(): string {
  return randomUUID()
}
