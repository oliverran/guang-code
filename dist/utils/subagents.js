import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
const emitter = new EventEmitter();
export function onSubagentEvent(listener) {
    emitter.on('event', listener);
    return () => emitter.off('event', listener);
}
export function emitSubagentEvent(e) {
    emitter.emit('event', e);
}
export function createSubagentId() {
    return randomUUID();
}
