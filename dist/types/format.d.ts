export declare function toolLabel(name: string, input: Record<string, unknown> | undefined, cwd: string): string;
export declare function runDoing(status: string): string;
export declare function runDoneLabel(run: {
    status: string;
    ms: number;
    started: number;
    cost: number;
}): string;
export declare function chatTitle(ask: string): string;
export declare function whenLabel(iso: string | undefined): string;
export declare function desktopHref(sessionId: string): string;
