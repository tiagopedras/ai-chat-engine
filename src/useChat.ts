import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ChatController, ChatView } from './controller';

/** The controller's current view, redrawn whenever it changes. */
export function useChat(controller: ChatController): ChatView {
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
}

/** Milliseconds now, ticking once a second while `on`. For a clock beside a run. */
export function useNow(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [on]);
  return now;
}
