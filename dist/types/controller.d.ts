import type { DockState } from './dock';
import type { ChatOptions, ChatStatus, Header, Origin, PermissionDecision, PermissionRequest, Rect, SessionRow, Turn } from './types';
export type StatusLine = {
    kind: 'permission';
} | {
    kind: 'running';
    doing: string;
    started: number;
} | {
    kind: 'text';
    text: string;
};
/** Everything a component draws from, as one immutable-by-convention object. */
export interface ChatView {
    open: boolean;
    /** Increments on every open, so a component can reset what belongs to one conversation. */
    openId: number;
    windowed: boolean;
    owner: string;
    session: string;
    /** What the window is called: the host's name for it if it gave one, otherwise one worked out from the session. */
    title: string;
    ownerLabel: string;
    subtitle: string;
    runState: string;
    desktopHref: string | null;
    status: StatusLine;
    turns: Turn[];
    busy: boolean;
    loading: boolean;
    loadErr: string;
    toobig: boolean;
    home: string;
    permission: PermissionRequest | null;
    placeholder: string;
    inlineTools: boolean;
    thinkingGlyphs: boolean;
    renamable: boolean;
    /** Whether the host asked for the minimise and anchor buttons. */
    dockable: boolean;
    /** Kept in the dock row for good, so it has no close button. */
    pinned: boolean;
    /** Whether to draw the "Can write" switch: the host asked for it and the helper allows writing. */
    writeSwitch: boolean;
    /** Where the switch sits: the open conversation is in write mode. */
    canWrite: boolean;
    presentation: {
        rect: Rect | null;
        growFrom: Origin | null;
        zIndex: number | undefined;
        active: boolean;
        peeked: boolean;
        /** Docked to the bottom edge as a bar or a panel, or 'none' for the ordinary modal or window. */
        dock: DockState;
        /** Where the dock row puts it, when docked. */
        dockRect: Rect | null;
    };
}
export declare class ChatController {
    private readonly opts;
    private readonly transport;
    private readonly windowed;
    private readonly defaultMode;
    private claudeStatus;
    private chatsIndex;
    private runs;
    private runCounter;
    private current;
    private header;
    private closing;
    private closeTimer;
    private openId;
    private originRect;
    private growOrigin;
    private rect;
    private zIndex;
    private active;
    private peeked;
    private readonly dockable;
    private readonly pin;
    private dock;
    private unDock;
    private listeners;
    private snap;
    constructor(opts?: ChatOptions);
    subscribe: (fn: () => void) => (() => void);
    getSnapshot: () => ChatView;
    private emit;
    available: () => boolean;
    status: () => ChatStatus | null;
    home: () => string;
    isOpen: () => boolean;
    sessionsFor: (key: string) => SessionRow[];
    newOwnerKey: () => string;
    private runFor;
    private currentRun;
    private currentTurns;
    loadStatus: () => Promise<void>;
    loadSessions: () => Promise<void>;
    forget: (ownerKey: string, sessionId: string) => Promise<void>;
    private openInternal;
    openNew: (ownerId: string, ownerKey: string, seed?: string, opts?: {
        preface?: (ask: string) => string;
    }) => void;
    openSession: (ownerId: string, ownerKey: string, sessionId: string) => void;
    closeChat: () => void;
    private finishClose;
    private loadTranscript;
    private handleRunEvent;
    private finishRun;
    private startRun;
    /** Send from the window: carries the open conversation on, or starts it. Returns whether anything was sent. */
    send: (text: string) => boolean;
    stop: () => void;
    retry: (i: number) => void;
    /** What to put back in the composer for a turn's Edit. */
    editText: (i: number) => string;
    takeSeed: () => string;
    answerPermission: (decision: PermissionDecision) => void;
    writeAllowed: () => boolean;
    setWrite: (on: boolean) => void;
    setHeader: (spec: Header | null) => void;
    rename: (title: string) => void;
    /** Call before openNew()/openSession(): the window grows out of this rect on the open that follows. Not sticky beyond that one open. */
    growFrom: (rect: Origin | DOMRect | Rect | null) => void;
    /** A rect this window did not choose and is not asked to justify: a saved position, a grid cell, a peek target. */
    setRect: (rect: Rect | null) => void;
    setZIndex: (z: number) => void;
    /** Whether a bare Escape is this window's to answer. */
    setActive: (v: boolean) => void;
    setPeeked: (v: boolean) => void;
    dockState: () => DockState;
    pinned: () => boolean;
    /** Whether any conversation this instance started is still running, open or not. */
    running: () => boolean;
    private setDock;
    private leaveDock;
    /** Down to a bar on the bottom edge: title, run state, close. */
    minimise: () => void;
    /** The full chat as a fixed panel on the bottom edge. */
    anchor: () => void;
    /** Back to the ordinary modal or window. */
    expand: () => void;
    rectLive: (r: Rect) => void;
    rectChange: (r: Rect) => void;
    pressed: () => void;
    destroy: () => void;
    private build;
}
