import type { Rect } from './types';

/* The row of docked chats along the bottom edge, shared by every instance on
   the page. Each chat is its own controller with its own React root, so none
   of them can see the others; this is the one place that knows the order, and
   works out where each one stands from it.

   The first chat docked sits in the bottom-right corner and each one after it
   lines up to its left, the way LinkedIn's message windows do. A chat that
   leaves the row closes its gap, since every place is worked out afresh from
   the order on each change. A pinned chat always takes the corner, whenever
   it joined, and the rest line up to its left. */

export type DockState = 'none' | 'minimised' | 'anchored';

export interface Dockable { dockState(): DockState; pinned?(): boolean }

const EDGE = 16;
const GAP = 12;
const MIN_W = 300;
const MIN_H = 52;
const ANCHOR_W = 400;
const ANCHOR_H = 560;

const docked: Dockable[] = [];
const listeners = new Set<() => void>();
let watching = false;

function notify(): void { listeners.forEach((fn) => fn()); }

/** A docked chat changed size: every one to its left moves. */
export const dockNotify = notify;

export function dockSubscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function dockJoin(c: Dockable): void {
  if (!docked.includes(c)) docked.push(c);
  if (!watching && typeof window !== 'undefined') {
    watching = true;
    window.addEventListener('resize', notify);
  }
  notify();
}

export function dockLeave(c: Dockable): void {
  const i = docked.indexOf(c);
  if (i < 0) return;
  docked.splice(i, 1);
  notify();
}

/* Pinned first, then the order they joined in. */
function row(): Dockable[] {
  return [...docked.filter((d) => d.pinned?.()), ...docked.filter((d) => !d.pinned?.())];
}

export function dockRectFor(c: Dockable): Rect | null {
  const order = row();
  const i = order.indexOf(c);
  if (i < 0) return null;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  let right = vw - EDGE;
  for (let n = 0; n < i; n++) {
    right -= (order[n].dockState() === 'anchored' ? ANCHOR_W : MIN_W) + GAP;
  }
  const anchored = c.dockState() === 'anchored';
  const width = anchored ? ANCHOR_W : MIN_W;
  const height = anchored ? Math.min(ANCHOR_H, vh - EDGE * 2) : MIN_H;
  return { x: right - width, y: vh - height, width, height };
}
