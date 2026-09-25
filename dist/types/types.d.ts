export interface ChatStatus {
    available: boolean;
    work?: boolean;
    cwd?: string;
    home?: string;
    model?: string;
    [key: string]: unknown;
}
/** One row of the sessions index: a conversation filed under an owner key. */
export interface SessionRow {
    id: string;
    title?: string;
    updated?: string;
    cwd?: string;
    mode?: 'ask' | 'work';
}
export type SessionsIndex = Record<string, SessionRow[]>;
/** What a turn shows, in the order it happened. */
export type FlowSegment = {
    kind: 'tool';
    label: string;
} | {
    kind: 'text';
    text: string;
};
export interface Turn {
    ask: string;
    reply: string;
    /** One-line labels of every tool call, for the collapsed trace. */
    tools: string[];
    /** The same content as `reply` and `tools`, in arrival order. */
    flow: FlowSegment[];
    error: string;
    detail: string;
    cost: number;
}
export interface PermissionRequest {
    requestId: string;
    toolName: string;
    title: string;
    description: string;
    canAlwaysAllow: boolean;
}
export type PermissionDecision = 'allow' | 'allow_always' | 'deny';
/** What the transcript call hands back for one turn. */
export interface TranscriptTurn {
    ask: string;
    reply?: string;
    tools?: Array<{
        name: string;
        input?: Record<string, unknown>;
    }>;
    /** Text and tool calls in the order Claude produced them. Read in preference to reply and tools when present. */
    parts?: Array<{
        type: 'text';
        text?: string;
    } | {
        type: 'tool';
        name: string;
        input?: Record<string, unknown>;
    }>;
}
export interface RunPayload {
    prompt: string;
    mode: 'ask' | 'work';
    session: string;
    owner: string;
    title: string;
}
export interface Transport {
    status(): Promise<ChatStatus>;
    sessions(): Promise<{
        chats: SessionsIndex;
    }>;
    transcript(sessionId: string, cwd: string): Promise<{
        turns: TranscriptTurn[];
        toobig?: boolean;
    }>;
    /** One stream-json line per step. board_start, board_error and board_permission ride the same stream. */
    run(payload: RunPayload, signal: AbortSignal): AsyncIterable<string>;
    forget(ownerKey: string, sessionId: string): Promise<void>;
    /** Optional. A backend that never asks a per-tool question has nothing to wire it to, and the banner simply never appears. */
    answerPermission?(requestId: string, decision: PermissionDecision): Promise<void>;
}
export interface Endpoints {
    status: string;
    sessions: string;
    transcript: string;
    forget: string;
    run: string;
    permission?: string;
}
export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}
export interface Origin {
    left: number;
    top: number;
    width: number;
    height: number;
}
export interface Header {
    title?: string;
    subtitle?: string;
    /** Stamped on the window as `data-state`, for a host stylesheet to pick up. */
    runState?: string;
}
export interface ChatOptions {
    endpoints?: Partial<Endpoints>;
    /** The header that guards the default transport's POSTs. A form cannot set one, so a page on another origin cannot reach the host's helper. */
    guardHeader?: {
        name: string;
        value: string;
    };
    transport?: Partial<Transport>;
    isLocked?: () => boolean;
    onChange?: () => void;
    onSessionsChanged?: (index: SessionsIndex) => void;
    onStatusChanged?: (status: ChatStatus | null) => void;
    /** Fired the instant a message leaves the box, before the run starts. `session` is empty on a new conversation's first message. */
    onSend?: (spec: {
        owner: string;
        key: string;
        session: string;
        ask: string;
        prompt: string;
        mode: 'ask' | 'work';
    }) => void;
    placeholder?: string;
    /** Off for a host that already is a Claude client, where the link would point back at itself. */
    desktopLink?: boolean;
    /** Each tool call as a pill where it happened, instead of one collapsed trace. */
    inlineTools?: boolean;
    /** A window the host places, instead of a centred modal. */
    windowed?: boolean;
    onRectLive?: (rect: Rect) => void;
    onRectChange?: (rect: Rect) => void;
    onFocus?: () => void;
    /** Minimise and anchor buttons in the head, docking the chat to the bottom-right edge. Off by default. */
    dockable?: boolean;
    /** The CLI's cycling asterisk instead of a turning ring. */
    thinkingGlyphs?: boolean;
    /** Makes the title editable in place and hands back what was typed. */
    onRename?: (title: string) => void;
    ownerLabel?: (owner: string) => string;
    /** What kind of conversation this host opens. */
    mode?: 'ask' | 'work';
}
