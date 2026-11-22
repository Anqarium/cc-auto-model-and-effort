// Declarations for lib/display.mjs, the names hooks/register.ts imports. Tested in test/display.test.mjs.
export declare function autoCommand(args: any, enabled: any): { enabled: boolean; message: string };
export declare function withFableCommand(args: any, enabled: any): { enabled: boolean; message: string };
export declare function fableNotice(enabled: any): string;
export declare function fallbackNotice(model: any): string;
export declare function statusNotice(enabled: any): string;
export declare function requestNotice(model: any): string;
export declare function logSummary(records: any, lastCount?: any): string;
export declare function label(decision: any): string;
export declare function labelStyle(decision: any): any;
export declare function modelStyle(family: any): any;
