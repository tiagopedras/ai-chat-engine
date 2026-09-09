/**
 * The contract between the session engine (this package) and whatever draws
 * a card with it — ported out of `ai_canvas`'s `src/shared/types.ts`, with
 * everything that is a host's own business rather than a session's stripped
 * out: no `geometry` (position, size, depth — the host's canvas owns that),
 * no `projectId` (grouping cards into sections is the host's, not this
 * package's), no `ViewState` or `WindowRect` (nothing here is drawn).
 *
 * What's left is what changes because of something Claude did, not because
 * of something a person dragged.
 */

/**
 * What the session is doing. `needs_you` is the only state that costs you
 * anything to miss, which is why it is a first-class state rather than a
 * flag on `running`. `parked` is a card restored from a previous run whose
 * process has not been started yet.
 */
export type RunState = 'parked' | 'idle' | 'running' | 'needs_you' | 'done' | 'error'

/** A pending `canUseTool` request, waiting on an answer from the host. */
export interface PendingPermission {
  requestId: string
  toolName: string
  /** A rendered prompt, e.g. "Claude wants to read foo.txt". */
  title: string
  /** Short noun phrase for a button label, e.g. "Read file". */
  displayName: string
  description?: string
  /**
   * The SDK offered a rule that would stop it asking again for this tool, so
   * "Always allow" is a real answer rather than a plain allow wearing a
   * different label.
   */
  canAlwaysAllow: boolean
}

/** Everything the engine knows about one session, geometry- and
    project-free — a host adds both on its own. */
export interface SessionCard {
  id: string
  /** Editable. Defaults to the opening prompt, truncated. */
  title: string
  /** The folder it works in. */
  cwd: string
  runState: RunState
  /** One line, live: "Editing SCHEMA.md", "Running tests". */
  activity: string
  /**
   * What the conversation is about, in Claude Code's own words — its
   * auto-generated session summary, refreshed after each turn. Null until
   * the CLI has produced one, which a brand new session has not yet.
   */
  summary: string | null
  /** SDK session id, once the session has initialised. Null before that. */
  sessionId: string | null
  pendingPermission: PendingPermission | null
  error: string | null
  /** This session failed because the CLI could not authenticate, rather
      than because the task went wrong. */
  authFailed: boolean
  /**
   * Claude Code no longer has a transcript for this session, so it can
   * never be woken. A flag rather than a reading of `error`, because a host
   * can offer a way out of this one — a fresh session in the same folder —
   * and must not offer it for any other failure.
   */
  orphaned: boolean
  /** This card is a branch of another session, named here. Its own
      messages go to a new transcript, so the original is left exactly as
      it was. */
  forkedFrom: string | null
  /** Wall-clock ms of the last event, for sorting and for "stuck" hints. */
  updatedAt: number
  /**
   * Wall-clock ms of the last message actually exchanged — a user prompt,
   * an assistant reply, a tool call. Unlike `updatedAt`, a rename leaves
   * this untouched, so it reads as "how long since anyone said anything"
   * rather than "how long since the card was last touched".
   */
  lastMessageAt: number
  /** The session has produced output since a host last had it open —
      see SessionPool.setOpenCards(). */
  unread: boolean
}

/** One line of a session's transcript, rendered when a session is open. */
export interface TranscriptEntry {
  id: string
  kind: 'user' | 'assistant' | 'tool' | 'result' | 'error'
  text: string
  at: number
}

/** A session Claude Code has on disk that is not currently tracked. */
export interface PastSession {
  sessionId: string
  title: string
  cwd: string
  lastModified: number
  gitBranch?: string
  /** Something else looks to be driving this session right now — a
      terminal, or another window. Resuming it in place would put two
      processes on one transcript, so it is branched instead. */
  live: boolean
}

export interface CreateSessionInput {
  cwd: string
  prompt: string
}

export interface ResumeSessionInput {
  sessionId: string
  cwd: string
  title: string
  /** Branch instead of continuing in place. Forced on when the session is
      live, because two processes writing one transcript silently strands
      one of them. */
  fork?: boolean
}

export interface PermissionAnswer {
  sessionId: string
  requestId: string
  decision: 'allow' | 'allow_always' | 'deny'
}

/**
 * One conversation the ai_chat widget is tracking for an owner key — the
 * shape `interface/README.md` documents as `{id, title, started, updated,
 * mode, cwd}`.
 */
export interface ChatSessionMeta {
  id: string
  title: string
  started: string
  updated: string
  mode: 'ask' | 'work'
  cwd: string
}

/** One block of a chat turn, in the order it happened — what `chat.js`'s
    `parts` field (see interface/README.md) is built from. */
export type ChatPart =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; input: Record<string, unknown> }

/** One turn of a replayed chat transcript, as `interface/chat.js`'s modal
    expects it. `parts` is optional and additive — see chatEngine.ts. */
export interface ChatTurn {
  ask: string
  reply: string
  tools: { name: string; input: Record<string, unknown> }[]
  parts?: ChatPart[]
}

export interface ChatStatus {
  available: boolean
  work: boolean
  cwd: string
  home: string
  model: string | null
}

/** What `interface/chat.js`'s `run` call sends — see interface/README.md. */
export interface ChatRunPayload {
  prompt: string
  mode: 'ask' | 'work'
  /** An existing chat session id to resume, or '' to start one. */
  session: string
  /** The owner key a new session should be filed under. */
  owner: string
  title: string
}

/**
 * The card-restore fields a host's own store keeps — enough to bring a
 * parked session back (see SessionPool.restoreParked). Geometry, window
 * rects, project membership and anything else about how a card is drawn
 * are the host's own business, kept in the host's own store under the same
 * `sessionId` rather than here.
 */
export interface StoredCard {
  /** The SDK session id. This is the identity that survives a restart. */
  sessionId: string
  cwd: string
  title: string
  forkedFrom: string | null
  /** Last time the session itself did anything, for ordering. */
  updatedAt: number
  /** Last time a message actually passed — see SessionCard.lastMessageAt. */
  lastMessageAt: number
}

/**
 * The persistence port for cards — decision from the ai_canvas split: this
 * package calls a small interface rather than owning a file format. A host
 * implements this against however it already saves things (a JSON file, a
 * database, whatever `ai_canvas`'s own board.json becomes once geometry and
 * projects are its own concern again).
 */
export interface CardStore {
  cards(): StoredCard[]
  /** Adds or replaces a card by session id. */
  put(card: StoredCard): void
  patch(sessionId: string, patch: Partial<StoredCard>): void
  /** A card's durable identity changes once, from the temporary id it was
      created with to its real SDK session id — see SessionPool.remember(). */
  rekey(from: string, to: string): void
  remove(sessionId: string): void
}

/** The persistence port for the ai_chat widget's own index — mirrors
    engine.py's SessionStore. A host that already has one store answering
    both this and CardStore is free to implement both on one class; the
    engine only ever calls the interface, never assumes they're the same
    object. */
export interface ChatStore {
  chats(): Record<string, ChatSessionMeta[]>
  recordChat(owner: string, sessionId: string, title: string, mode: 'ask' | 'work', cwd: string): void
  touchChat(owner: string, sessionId: string): void
  forgetChat(owner: string, sessionId: string): void
}
