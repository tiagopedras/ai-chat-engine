import type { ChatController, ChatView } from './controller';
/** The controller's current view, redrawn whenever it changes. */
export declare function useChat(controller: ChatController): ChatView;
/** Milliseconds now, ticking once a second while `on`. For a clock beside a run. */
export declare function useNow(on: boolean): number;
