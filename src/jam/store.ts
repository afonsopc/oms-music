/**
 * Jam store (FR-113..117): the zustand mirror of JamChannel truth.
 *
 * Roles are DERIVED, never set: `isHost` = the jam's host_id is us,
 * `following` = we are in a jam and are NOT the host. A host keeps playing
 * through the normal engine (the server relays their publishes to the jam);
 * only a follower runs the second player, so only a follower's shell swaps
 * the MiniPlayer for the JamBar.
 *
 * `followerPosition` is a leaf field written at the follower player's status
 * cadence: select it in isolation, like the player store's position slice.
 */
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import type { UserId } from "@/domain/ids";
import type { Jam, JamState } from "@/domain/jam";

export interface JamStoreState {
  /** The active jam we are a member of (host or follower). */
  jam: Jam | null;
  /** The host's playback slice; null until the first snapshot. */
  state: JamState | null;
  /** Our own user id, planted by register.ts from the session store. */
  myUserId: UserId | null;
  /** Follower-local pause: does not touch the jam (there is no API for it). */
  localPaused: boolean;
  /** Follower playback position, leaf slice. */
  followerPosition: number;
  /** Running skip tally; reset SILENTLY whenever the state song id changes. */
  skipVotes: { count: number; needed: number } | null;
  /** Join timestamp: the 1.5 s grace before local playback auto-leaves. */
  joinedAtMs: number;
}

export const initialJamState: JamStoreState = {
  jam: null,
  state: null,
  myUserId: null,
  localPaused: false,
  followerPosition: 0,
  skipVotes: null,
  joinedAtMs: 0,
};

export const jamStore = createStore<JamStoreState>()(() => ({ ...initialJamState }));

export const applyJam = (partial: Partial<JamStoreState>): void => {
  jamStore.setState(partial);
};

/** Leaving / ended / rejected: everything but our identity goes away. */
export const clearJamState = (): void => {
  jamStore.setState((prev) => ({
    ...initialJamState,
    myUserId: prev.myUserId,
  }));
};

export const resetJamStore = (): void => {
  jamStore.setState({ ...initialJamState }, true);
};

// ---------------------------------------------------------------------------
// Pure derivations (kept out of components so they stay unit-testable)
// ---------------------------------------------------------------------------

export const selectIsHost = (s: JamStoreState): boolean =>
  !!s.jam && !!s.myUserId && s.jam.host_id === s.myUserId;

/** Member of a jam that somebody else hosts: this device follows the host. */
export const selectFollowing = (s: JamStoreState): boolean =>
  !!s.jam && !!s.myUserId && s.jam.host_id !== s.myUserId;

/** Proposals are open to members only while the host allows them. */
export const selectCanPropose = (s: JamStoreState): boolean =>
  selectFollowing(s) && s.jam?.queue_mode === "everyone";

/** Vote UI is hidden for non-hosts in host mode (FR-117 AC). */
export const selectCanVoteSkip = (s: JamStoreState): boolean => {
  if (!s.jam) return false;
  if (s.jam.skip_mode !== "host") return true;
  return selectIsHost(s);
};

/** React hook; always pass a selector (keep them pure and stable). */
export const useJamStore = <T>(selector: (state: JamStoreState) => T): T =>
  useStore(jamStore, selector);
