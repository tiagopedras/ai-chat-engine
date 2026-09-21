import type { ChatOptions } from './types';
export declare function create(opts?: ChatOptions): {
    loadStatus: () => Promise<void>;
    loadSessions: () => Promise<void>;
    available: () => boolean;
    status: () => import("./types").ChatStatus | null;
    home: () => string;
    sessionsFor: (key: string) => import("./types").SessionRow[];
    newOwnerKey: () => string;
    forget: (ownerKey: string, sessionId: string) => Promise<void>;
    isOpen: () => boolean;
    closeChat: () => void;
    openNew(ownerId: string, ownerKey: string, seed?: string, o?: {
        preface?: (ask: string) => string;
    }): void;
    openSession(ownerId: string, ownerKey: string, sessionId: string): void;
    growFrom: (rect: import("./types").Origin | DOMRect | import("./types").Rect | null) => void;
    setRect: (rect: import("./types").Rect | null) => void;
    setZIndex: (z: number) => void;
    setActive: (v: boolean) => void;
    setPeeked: (v: boolean) => void;
    setHeader: (spec: import("./types").Header | null) => void;
    /** Takes the instance off the page for good: its markup, its listeners and any run in flight. closeChat() only hides it. */
    destroy(): void;
};
export type ChatInstance = ReturnType<typeof create>;
