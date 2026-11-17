// Declarations for lib/select.mjs, the names hooks/register.ts imports. The logic is tested in test/select.test.mjs.
// Shapes the caller relies on are typed; the rest are `any` so a wrong guess here cannot hide a real error.
export declare const MODELS: { readonly haiku: "haiku"; readonly sonnet: "sonnet"; readonly opus: "opus"; readonly fable: "fable" };
export declare const SEED_IDS: { haiku: string; sonnet: string; opus: string; fable: string };
export declare function learnModel(ids: any, seen: any): any;
export declare function effortToSend(incoming: any, chosen: any): any;
export declare function withoutFable(decision: any, efforts?: any): any;
export declare function forcedModel(text: any): any;
export declare function modelKeywords(text: any): { family: string; start: number; end: number }[];
export declare function decide(text: any, options?: any): any;
