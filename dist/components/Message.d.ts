import React from 'react';
import type { SessionMessage } from '../types/index.js';
type MessageProps = {
    message: SessionMessage;
    showTimestamp?: boolean;
};
export declare function MessageView({ message, showTimestamp }: MessageProps): React.JSX.Element | null;
export {};
