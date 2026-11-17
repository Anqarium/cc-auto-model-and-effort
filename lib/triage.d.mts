// Declarations for lib/triage.mjs, the names hooks/register.ts imports. Tested in test/triage.test.mjs.
export declare const TRIAGE_HEADERS: { "content-type": string; "anthropic-version": string };
export declare const TRIAGE_URL: string;
export declare function parseTriageResponse(response: any): any;
export declare function promptImages(apiMessages: any): any;
export declare function triageBody(text: any, images: any, model: any): any;
