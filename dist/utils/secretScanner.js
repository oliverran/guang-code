const PATTERNS = [
    { kind: 'private-key', confidence: 'high', re: /-----BEGIN [A-Z0-9 ]+ PRIVATE KEY-----/ },
    { kind: 'anthropic-api-key', confidence: 'high', re: /\bsk-ant-[a-zA-Z0-9_-]{10,}\b/ },
    { kind: 'openai-api-key', confidence: 'high', re: /\bsk-[a-zA-Z0-9]{20,}\b/ },
    { kind: 'github-token', confidence: 'high', re: /\bghp_[A-Za-z0-9]{30,}\b/ },
    { kind: 'github-token', confidence: 'high', re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/ },
    { kind: 'aws-access-key-id', confidence: 'high', re: /\bAKIA[0-9A-Z]{16}\b/ },
    { kind: 'gcp-service-account', confidence: 'high', re: /"type"\s*:\s*"service_account"/ },
    { kind: 'generic-bearer-token', confidence: 'medium', re: /\bBearer\s+[A-Za-z0-9._-]{20,}\b/ },
];
export function findSecrets(text, maxFindings = 3) {
    const t = text ?? '';
    if (!t)
        return [];
    const out = [];
    for (const p of PATTERNS) {
        if (p.re.test(t)) {
            out.push({ kind: p.kind, confidence: p.confidence });
            if (out.length >= maxFindings)
                break;
        }
    }
    return out;
}
export function hasSecrets(text) {
    return findSecrets(text, 1).length > 0;
}
export function redactIfSecrets(text) {
    const found = findSecrets(text, 10);
    if (found.length === 0)
        return { redacted: text, found };
    return { redacted: '[REDACTED: potential secrets detected]', found };
}
