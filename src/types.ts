/* The shapes the chat window passes around. Nothing here knows about React;
   the controller and the transport work on these, and the components read
   them. */

/** ask reads only; write may edit inside its working directory; work does anything. */
export type ChatMode = 'ask' | 'write' | 'work';

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
  mode?: ChatMode;
}

export type SessionsIndex = Record<string, SessionRow[]>;

/** What a turn shows, in the order it happened. */
export type FlowSegment =
  | { kind: 'tool'; label: string }
  | { kind: 'text'; text: string };

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
  tools?: Array<{ name: string; input?: Record<string, unknown> }>;
  /** Text and tool calls in the order Claude produced them. Read in preference to reply and tools when present. */
  parts?: Array<{ type: 'text'; text?: string } | { type: 'tool'; name: string; input?: Record<string, unknown> }>;
}

export interface RunPayload {
  prompt: string;
  mode: ChatMode;
  session: string;
  owner: string;
  title: string;
}

/* The calls the window makes, and nothing else it needs from a host. A host
   with no HTTP between the page and Claude (an Electron renderer over IPC)
   passes only the ones it implements, and the rest stay on fetch.

   Errors thrown from any of these become the message shown in the window
   (`run`'s must already be readable, since it is shown verbatim), so a custom
   transport throws new Error('something a person can read') rather than
   letting a raw platform error escape. */
export interface Transport {
  status(): Promise<ChatStatus>;
  sessions(): Promise<{ chats: SessionsIndex }>;
  transcript(sessionId: string, cwd: string): Promise<{ turns: TranscriptTurn[]; toobig?: boolean }>;
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

export interface Rect { x: number; y: number; width: number; height: number }
export interface Origin { left: number; top: number; width: number; height: number }

export interface Header {
  title?: string;
  subtitle?: string;
  /** Stamped on the window as `data-state`, for a host stylesheet to pick up. */
  runState?: string;
}

export interface ChatOptions {
  endpoints?: Partial<Endpoints>;
  /** The header that guards the default transport's POSTs. A form cannot set one, so a page on another origin cannot reach the host's helper. */
  guardHeader?: { name: string; value: string };
  transport?: Partial<Transport>;
  isLocked?: () => boolean;
  onChange?: () => void;
  onSessionsChanged?: (index: SessionsIndex) => void;
  onStatusChanged?: (status: ChatStatus | null) => void;
  /** Fired the instant a message leaves the box, before the run starts. `session` is empty on a new conversation's first message. */
  onSend?: (spec: { owner: string; key: string; session: string; ask: string; prompt: string; mode: ChatMode }) => void;
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
  /** Keeps the chat in the dock row for good: it always sits in the
      bottom-right corner, and closing it minimises it instead. Needs `dockable`. */
  pinned?: boolean;
  /** The CLI's cycling asterisk instead of a turning ring. */
  thinkingGlyphs?: boolean;
  /** Makes the title editable in place and hands back what was typed. */
  onRename?: (title: string) => void;
  ownerLabel?: (owner: string) => string;
  /** What kind of conversation this host opens. */
  mode?: ChatMode;
  /** A "Can write" switch in the head, flipping the open conversation between
      reading only and `write` mode from its next message. Drawn only while the
      helper's status says `work` is on. Off by default. */
  writeSwitch?: boolean;
  /** The line put in front of the first message after the switch moves, so
      Claude hears that what it said earlier about being able to write no
      longer holds. Given whether writing is now on. The engine has its own. */
  writeNote?: (on: boolean) => string;
}
