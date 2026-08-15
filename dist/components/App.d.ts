import React from 'react';
import type { AppState } from '../types/index.js';
type Props = {
    initialState: AppState;
    /** CLI-level --api-key override; takes priority over config file keys */
    apiKeyOverride?: string;
};
export declare function App({ initialState, apiKeyOverride }: Props): React.JSX.Element;
export {};
