export type SubagentEvent = {
    type: 'started';
    id: string;
    description: string;
} | {
    type: 'named';
    id: string;
    name: string;
} | {
    type: 'progress';
    id: string;
    message: string;
} | {
    type: 'completed';
    id: string;
    report: string;
} | {
    type: 'failed';
    id: string;
    error: string;
};
type Listener = (e: SubagentEvent) => void;
export declare function onSubagentEvent(listener: Listener): () => void;
export declare function emitSubagentEvent(e: SubagentEvent): void;
export declare function createSubagentId(): string;
export {};
