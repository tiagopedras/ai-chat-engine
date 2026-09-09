/**
 * `@tiagopedras/ai-chat-engine/node` — the session engine, without a canvas.
 *
 * Ported out of `ai_canvas`'s `src/main/*`, with everything that was a
 * board's own business rather than a session's taken back out: no
 * geometry, no window rects, no projects, no view state. A host wires
 * `SessionPool` to its own UI and its own `CardStore`, and `ChatEngine` to
 * `interface/chat.js`'s modal the same way `engine.py` does for a Python
 * host — see this package's root README for both.
 */

export { Session, type SessionEvents, type SessionInit } from './session.js'
export { SessionPool, type PoolEvents } from './sessionPool.js'
export { ChatEngine, type ChatEngineOptions } from './chatEngine.js'
export { describe, describeTool } from './describeTool.js'
export { unwrapSlashCommand } from './slashCommand.js'
export { checkAuth, explainAuthFailure, isAuthFailure, type AuthState } from './auth.js'
export { detectLiveSessions, type Liveness } from './liveness.js'
export type {
  CardStore,
  ChatPart,
  ChatRunPayload,
  ChatSessionMeta,
  ChatStatus,
  ChatStore,
  ChatTurn,
  CreateSessionInput,
  PastSession,
  PendingPermission,
  PermissionAnswer,
  ResumeSessionInput,
  RunState,
  SessionCard,
  StoredCard,
  TranscriptEntry
} from './types.js'
