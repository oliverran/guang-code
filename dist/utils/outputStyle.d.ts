import type { OutputStyle } from '../types/index.js';
export declare function getOutputStylePrompt(style: OutputStyle | undefined): {
    name: OutputStyle;
    prompt: string;
};
