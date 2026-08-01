/**
 * Friends listening feed (FR-119) over FriendListeningChannel.
 *
 * Wire contract (API.md 13.3): a `snapshot` on subscribe, then
 * `listening_update` frames whose FriendListening fields sit at the TOP
 * level next to `type` (not nested). Each update is a FULL ROW REPLACE keyed
 * by `user.id`, appended when new. Updates fire on song / pause / jam
 * transitions, never on position ticks.
 *
 * Two things the wire does not tell you and this module must handle:
 * - rosters are SUBSCRIBE-TIME: a new friendship or a privacy flip only
 *   lands on the next subscribe, so the foreground wake hook resubscribes;
 * - the double privacy layer means a sharing-off friend still appears with
 *   `song: null` - presence without the song, never a hidden row.
 *
 * Free of react-native imports so the sort and the reducer run in bun.
 */
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import type { CableClient, CableSubscription } from "@/cable/types";
import type { FriendListening } from "@/domain/social";

export interface ListeningStoreState {
  friends: FriendListening[];
  /** Subscription confirmed by the server (not just socket-open). */
  ready: boolean;
}

export const initialListeningState: ListeningStoreState = { friends: [], ready: false };

export const listeningStore = createStore<ListeningStoreState>()(() => ({
  ...initialListeningState,
}));

export const useListeningStore = <T>(selector: (state: ListeningStoreState) => T): T =>
  useStore(listeningStore, selector);

export const resetListeningStore = (): void => {
  listeningStore.setState({ ...initialListeningState, friends: [] }, true);
};

// ---------------------------------------------------------------------------
// Pure reducers (unit-tested)
// ---------------------------------------------------------------------------

/** Live rows first (online, not paused, actually sharing), then recency. */
export const sortFriendListening = (rows: readonly FriendListening[]): FriendListening[] =>
  [...rows].sort((a, b) => {
    const liveA = a.online && !a.paused && a.song ? 1 : 0;
    const liveB = b.online && !b.paused && b.song ? 1 : 0;
    if (liveA !== liveB) return liveB - liveA;
    const tA = a.updated_at ? Date.parse(a.updated_at) : 0;
    const tB = b.updated_at ? Date.parse(b.updated_at) : 0;
    return (Number.isNaN(tB) ? 0 : tB) - (Number.isNaN(tA) ? 0 : tA);
  });

/** Full-row replace by user id, append when new, then re-sort. */
export const upsertFriendListening = (
  rows: readonly FriendListening[],
  row: FriendListening,
): FriendListening[] =>
  sortFriendListening([...rows.filter((r) => r.user.id !== row.user.id), row]);

/** A live row is one the strip is allowed to show (FR-29). */
export const hasListeningRows = (rows: readonly FriendListening[]): boolean =>
  rows.some((row) => !!row.song);

// ---------------------------------------------------------------------------
// Channel manager
// ---------------------------------------------------------------------------

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : null;

const asListeningRow = (value: Record<string, unknown>): FriendListening | null => {
  const user = asRecord(value.user);
  if (!user || typeof user.id !== "string") return null;
  return value as unknown as FriendListening;
};

export interface FriendListeningManagerDeps {
  cable: CableClient;
  /**
   * Deferred scheduler for the foreground resubscribe. It MUST be async:
   * the wake hook runs while the cable iterates its subscription map, and
   * resubscribing in place would re-enter the very hook being iterated.
   */
  defer?(fn: () => void): void;
}

export class FriendListeningManager {
  private sub: CableSubscription | null = null;
  private started = false;

  constructor(private readonly deps: FriendListeningManagerDeps) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    this.open();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.sub?.unsubscribe();
    this.sub = null;
    resetListeningStore();
  }

  isStarted(): boolean {
    return this.started;
  }

  private open(): void {
    const sub = this.deps.cable.subscribe(
      { channel: "FriendListeningChannel" },
      {
        onMessage: (msg) => this.handleMessage(msg),
        onConfirm: () => listeningStore.setState({ ready: true }),
        // Anonymous cable connects succeed; a rejection IS the auth failure.
        onReject: () => listeningStore.setState({ ready: false }),
      },
    );
    // Rosters are subscribe-time: a fresh subscribe is the only way to pick
    // up new friends and privacy flips, and it re-transmits the snapshot.
    sub.setWakeHook(() => this.scheduleResubscribe());
    this.sub = sub;
  }

  private scheduleResubscribe(): void {
    const defer = this.deps.defer ?? ((fn: () => void) => setTimeout(fn, 0));
    defer(() => {
      if (!this.started) return;
      this.sub?.unsubscribe();
      this.sub = null;
      this.open();
    });
  }

  private handleMessage(raw: unknown): void {
    const msg = asRecord(raw);
    if (!msg) return;
    if (msg.type === "snapshot") {
      const friends = Array.isArray(msg.friends) ? (msg.friends as FriendListening[]) : [];
      listeningStore.setState({ friends: sortFriendListening(friends), ready: true });
      return;
    }
    if (msg.type === "listening_update") {
      const row = asListeningRow(msg);
      if (!row) return;
      listeningStore.setState((prev) => ({
        friends: upsertFriendListening(prev.friends, row),
      }));
    }
  }
}
