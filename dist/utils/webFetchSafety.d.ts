export type ValidatedUrl = {
    url: URL;
    normalized: string;
    hostname: string;
};
export declare function validateUrlString(raw: string): ValidatedUrl;
export declare function isLoopbackHost(hostname: string): boolean;
export declare function isIpLiteral(hostname: string): boolean;
export declare function isPrivateOrLinkLocalIp(ip: string): boolean;
export declare function resolveHostIps(hostname: string): Promise<string[]>;
