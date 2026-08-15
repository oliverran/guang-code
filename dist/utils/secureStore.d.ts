export type SecretStoreKind = 'plaintext' | 'windows-dpapi';
export declare function preferredSecretStore(): SecretStoreKind;
export declare function encryptForStore(secret: string, kind: SecretStoreKind): {
    kind: SecretStoreKind;
    value: string;
};
export declare function decryptFromStore(value: string, kind: SecretStoreKind): string;
