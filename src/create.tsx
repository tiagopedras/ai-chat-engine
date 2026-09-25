import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { ChatController } from './controller';
import { ChatWindow } from './ChatWindow';
import type { ChatOptions } from './types';

/* The imperative way in, for a page that is not a React app: the board's
   plain scripts, or a card's window in a canvas that creates one per card.

     const chat = create({ endpoints: {...} });   // once
     chat.loadStatus();                           // once, on load
     chat.openNew(ownerId, ownerKey, seedText);   // to start a chat

   and read back what is needed with chat.available(), chat.sessionsFor(key)
   and so on, to draw its own "chats on this thing" list wherever that belongs
   on its own page. The window itself mounts on first use, into its own node
   in the body, and nothing in the host page has to exist beforehand.

   Every call is its own instance: open several at once and none of them ever
   resolves into another's markup. */
export function create(opts: ChatOptions = {}) {
  const controller = new ChatController(opts);
  let host: HTMLElement | null = null;
  let root: Root | null = null;

  /* Not at create(): an instance per card is made for every card on a canvas,
     and most are never opened. */
  const mount = () => {
    if (root) return;
    host = document.createElement('div');
    host.setAttribute('data-ai-chat', '');
    document.body.appendChild(host);
    root = createRoot(host);
    root.render(<ChatWindow controller={controller} />);
  };

  return {
    loadStatus: controller.loadStatus,
    loadSessions: controller.loadSessions,
    available: controller.available,
    status: controller.status,
    home: controller.home,
    sessionsFor: controller.sessionsFor,
    newOwnerKey: controller.newOwnerKey,
    forget: controller.forget,
    isOpen: controller.isOpen,
    closeChat: controller.closeChat,
    openNew(ownerId: string, ownerKey: string, seed?: string, o?: { preface?: (ask: string) => string }) {
      mount();
      controller.openNew(ownerId, ownerKey, seed, o);
    },
    openSession(ownerId: string, ownerKey: string, sessionId: string) {
      mount();
      controller.openSession(ownerId, ownerKey, sessionId);
    },
    growFrom: controller.growFrom,
    setRect: controller.setRect,
    setZIndex: controller.setZIndex,
    setActive: controller.setActive,
    setPeeked: controller.setPeeked,
    setHeader: controller.setHeader,
    minimise: controller.minimise,
    anchor: controller.anchor,
    expand: controller.expand,
    dockState: controller.dockState,
    running: controller.running,
    /** The session the open conversation is on, or '' for a new one not yet sent or nothing open. */
    session: (): string => controller.getSnapshot().session,
    /** Takes the instance off the page for good: its markup, its listeners and any run in flight. closeChat() only hides it. */
    destroy() {
      controller.destroy();
      root?.unmount();
      host?.remove();
      root = null;
      host = null;
    },
  };
}

export type ChatInstance = ReturnType<typeof create>;
