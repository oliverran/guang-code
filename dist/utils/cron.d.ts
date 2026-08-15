export type ParsedCron = {
    minutes: Set<number>;
    hours: Set<number>;
    dom: Set<number>;
    months: Set<number>;
    dow: Set<number>;
};
export declare function parseCronExpression(expr: string): ParsedCron | null;
export declare function cronMatches(expr: string, date: Date): boolean;
export declare function minuteBucket(ts: number): number;
