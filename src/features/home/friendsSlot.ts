/**
 * Friends listening strip slot (FR-29 placement half). Home owns WHERE the
 * strip renders (filter = all, between the top tiles and the mix rail); the
 * strip itself is `features/friends` content (WP10), registered here via
 * boot/wireup.ts so Home never imports the friends feature directly.
 *
 * The slot decides its own visibility (`isActive`: live friends exist), the
 * same shape as the shell overlay slots, so the section collapses cleanly
 * when no friend is listening.
 */
import { useSyncExternalStore, type ComponentType } from "react";

export interface HomeFriendsSlot {
  /** Synchronous read: are there live rows to show right now? */
  isActive(): boolean;
  subscribe(cb: () => void): () => void;
  Component: ComponentType;
}

let slot: HomeFriendsSlot | null = null;
const listeners = new Set<() => void>();

/** WP10 registers the friends strip content (via boot/wireup.ts). */
export const registerFriendsStrip = (next: HomeFriendsSlot): void => {
  slot = next;
  for (const cb of listeners) cb();
};

const subscribe = (cb: () => void): (() => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

const getSlot = (): HomeFriendsSlot | null => slot;

export const useFriendsStripSlot = (): HomeFriendsSlot | null =>
  useSyncExternalStore(subscribe, getSlot, getSlot);

/** Whether the registered slot wants to render (false when unregistered). */
export const useFriendsStripActive = (current: HomeFriendsSlot | null): boolean =>
  useSyncExternalStore(
    current ? current.subscribe : subscribe,
    current ? current.isActive : () => false,
    current ? current.isActive : () => false,
  );
