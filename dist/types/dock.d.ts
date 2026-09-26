import type { Rect } from './types';
export type DockState = 'none' | 'minimised' | 'anchored';
export interface Dockable {
    dockState(): DockState;
    pinned?(): boolean;
}
declare function notify(): void;
/** A docked chat changed size: every one to its left moves. */
export declare const dockNotify: typeof notify;
export declare function dockSubscribe(fn: () => void): () => void;
export declare function dockJoin(c: Dockable): void;
export declare function dockLeave(c: Dockable): void;
export declare function dockRectFor(c: Dockable): Rect | null;
export {};
