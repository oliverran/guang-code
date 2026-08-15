export type SecretFinding = {
    kind: string;
    confidence: 'high' | 'medium';
};
export declare function findSecrets(text: string, maxFindings?: number): SecretFinding[];
export declare function hasSecrets(text: string): boolean;
export declare function redactIfSecrets(text: string): {
    redacted: string;
    found: SecretFinding[];
};
