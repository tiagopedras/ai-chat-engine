/* The public surface. `ChatWindow` and `useChat` for a React app that mounts
   the window itself; `ChatController` for one that wants the state without the
   window; `create` for a page with no React of its own. */
export { ChatWindow } from './ChatWindow';
export { ChatController } from './controller';
export type { ChatView, StatusLine } from './controller';
export { useChat } from './useChat';
export { create } from './create';
export type { ChatInstance } from './create';
export { makeDefaultTransport, DEFAULT_ENDPOINTS } from './transport';
export { chatTitle, toolLabel, whenLabel, desktopHref } from './format';
export type {
  ChatOptions, ChatStatus, Header, Origin, PermissionDecision, PermissionRequest, Rect,
  RunPayload, SessionRow, SessionsIndex, Transport, TranscriptTurn, Turn, FlowSegment, Endpoints,
} from './types';
