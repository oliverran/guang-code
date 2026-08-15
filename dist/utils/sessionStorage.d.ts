import type { SessionMessage } from '../types/index.js';
export type SavedSession = {
    id: string;
    title?: string;
    createdAt: number;
    updatedAt: number;
    cwd: string;
    model: string;
    messages: SessionMessage[];
    inputTokens: number;
    outputTokens: number;
};
export declare function saveSession(session: SavedSession): Promise<void>;
export declare function loadSession(sessionId: string): Promise<SavedSession | null>;
export declare function listSessions(): Promise<SavedSession[]>;
export declare function getSessionsDir(): string;
