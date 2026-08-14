/**
 * The impure half of predictive prefetch: module-level state, one timer, one
 * outstanding transfer, and a platform host.
 *
 * NO REACT. Nothing in this file causes a component to render - it holds no
 * store, publishes no version counter and exposes no hook. The collection
 * screen writes geometry into a module variable at scroll cadence; every
 * decision happens later, once, on a debounced timer. That property is not an
 * optimization, it is the reason this feature is allowed to exist at all
 * after the 2026-08-14 freeze report.
 *
 * The loop:
 *   reportListGeometry / setPrefetchCollection / a queue bucket change
 *      -> schedule() arms ONE timer (re-entrant calls reset it)
 *      -> fire() reads the gates, builds signals, computes wants
 *      -> at most ONE predictive audio transfer is started
 *
 * Every gate is read at FIRE time, never at arm time: a GO OFFLINE flip
 * between arming and firing must CANCEL the transfer, not merely delay it
 * (mirrors the play-cache timer in downloads/register.ts).
 */
import type { MediaId, SongKey } from "@/domain/ids";
import { toSongKey } from "@/domain/ids";
import type { Song } from "@/domain/song";
import { playerStore, type PlayerStoreState } from "@/player/store";
import { COLLECTION_START_DELAY_MS, SUPERSEDE_DEBOUNCE_MS, SUPERSEDE_MIN_PROGRESS } from "./constants";
import { viewportIndices, type ListGeometry } from "./geometry";
import { prefetchAllowed, type PrefetchGates } from "./gates";
import { computeWants } from "./policy";
import {
  toPrefetchSong,
  wantKey,
  type CollectionSignal,
  type PrefetchSong,
  type QueueSignal,
  type ViewportSignal,
} from "./types";

/**
 * Everything the driver cannot do by itself. Implemented over the download
 * manager on native (prefetch/register.ts) and over the Rust cache on the
 * Tauri desktop shell (downloads/desktop/manager.ts, owner C).
 */
export interface PrefetchHost {
  resident(songKey: SongKey, kind: "mixed"): boolean;
  inFlight(songKey: SongKey, kind: "mixed"): boolean;
  explicitInFlight(): number;
  /**
   * `song` is the source row the want was derived from. The desktop host
   * (owner C) ignores it - the Rust cache keys by media id alone - and a
   * two-parameter implementation still satisfies this type, so the contract
   * stays compatible in both directions.
   */
  startAudio(songKey: SongKey, mediaId: MediaId, song: Song): void;
  cancelAudio(songKey: SongKey): void;
  progressOf(songKey: SongKey): number;
  prefetchArtwork(mediaIds: MediaId[]): void;
  gates(): PrefetchGates;
  /**
   * Waste instrumentation + the per-session predictive byte budget. Fed with
   * REAL completed bytes by the platform binding (the driver never guesses a
   * size), and read back through `gates().sessionBudgetExhausted`.
   */
  noteBytes(n: number): void;
}

// ---------------------------------------------------------------------------
// Module state. All of it is deliberately plain: no store, no subscribers.
// ---------------------------------------------------------------------------

let host: PrefetchHost | null = null;
let collection: CollectionSignal | null = null;
let geometry: ListGeometry | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
/** Earliest legal fire time after a collection identity change. */
let earliestFireAt = 0;
/** The single predictive audio transfer in flight, if any. */
let outstanding: { songKey: SongKey; mediaId: MediaId } | null = null;
let queueUnsubscribe: (() => void) | null = null;

const now = (): number => Date.now();

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export const setPrefetchHost = (h: PrefetchHost): void => {
  host = h;
  ensureQueueSubscription();
};

/**
 * Screen mount / list identity change. Pass null on unmount: that is the
 * CANCEL half of the prefetch API, and forgetting it is how a home-grown
 * prefetcher ends up driving transfers for a list nobody is looking at.
 */
export const setPrefetchCollection = (c: CollectionSignal | null): void => {
  if (c == null) {
    collection = null;
    geometry = null;
    clearTimer();
    cancelOutstanding();
    return;
  }
  const previous = collection;
  collection = c;
  if (previous?.key !== c.key) {
    // A new list: the old geometry describes the wrong rows entirely, and
    // "unknown centre" is what makes the policy target row 0.
    geometry = null;
    earliestFireAt = now() + COLLECTION_START_DELAY_MS;
    schedule();
    return;
  }
  // Same list, republished. A screen that rebuilds its `songs` array on
  // every render would otherwise reset the debounce timer forever and the
  // driver would NEVER fire - so a republish only re-arms when the roster
  // actually grew (pagination) or shrank.
  if (previous.songs.length !== c.songs.length) schedule();
};

/**
 * Called from the collection screen's EXISTING scroll callback. Writes a
 * module variable and resets a timer; renders nothing, subscribes nothing,
 * allocates one small object per scroll frame.
 */
export const reportListGeometry = (g: ListGeometry): void => {
  geometry = g;
  schedule();
};

/**
 * A gate SOURCE changed (GO OFFLINE, connectivity, the predictive settings).
 * Re-reads the gates immediately and kills the outstanding transfer when they
 * now forbid it.
 *
 * Reading gates at fire time makes arm -> fire safe; it does nothing at all for
 * fire -> completion. Without this, flipping GO OFFLINE mid-transfer only
 * prevented the NEXT guess: the megabytes already streaming kept streaming for
 * the whole remaining duration, which on cellular is the user paying for bytes
 * they explicitly forbade. `schedule()` is deliberately NOT reused - its
 * `Math.max(SUPERSEDE_DEBOUNCE_MS, ...)` floor would leave 700 ms of forbidden
 * transfer, and the whole point is that the cancel is synchronous.
 */
export const revokePrefetch = (): void => {
  const h = host;
  if (!h) return;
  if (prefetchAllowed(h.gates())) return;
  clearTimer();
  cancelOutstanding();
};

/** Logout / session close: forget everything and cancel what is running. */
export const stopPrefetch = (): void => {
  clearTimer();
  cancelOutstanding();
  collection = null;
  geometry = null;
  earliestFireAt = 0;
};

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

const clearTimer = (): void => {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
};

/**
 * One timer, reset on every signal. This is the idle gate: a fling across 200
 * rows produces exactly ONE recompute and therefore at most one
 * queued -> downloading -> done triple on the coarse status channel. The
 * naive version would be 200 enqueues and 400 coarse transitions, i.e. every
 * mounted badge re-rendered 400 times.
 */
const schedule = (): void => {
  if (!host) return;
  const settleDelay = SUPERSEDE_DEBOUNCE_MS;
  const startDelay = Math.max(0, earliestFireAt - now());
  const delay = Math.max(settleDelay, startDelay);
  clearTimer();
  timer = setTimeout(fire, delay);
};

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

const viewportSignal = (): ViewportSignal =>
  geometry ? viewportIndices(geometry) : { centerIndex: null, first: null, last: null };

/**
 * The queue window, built as at most THREE entries (previous / current /
 * next) instead of mapping the whole queue: the policy only ever reaches one
 * step either side of the cursor, and a 500-song queue mapped on every fire
 * would be pure allocation. `currentIndex` is rewritten to the cursor's
 * position inside the window, so `currentIndex > 0` still means exactly
 * "there is a previous track".
 */
const queueSignal = (state: PlayerStoreState): QueueSignal | null => {
  const { queue, queueOrder, queueIndex } = state;
  if (queue.length === 0 || queueOrder.length === 0) return null;
  const songs: PrefetchSong[] = [];
  let currentIndex = 0;
  for (let offset = -1; offset <= 1; offset += 1) {
    const orderIndex = queueIndex + offset;
    if (orderIndex < 0 || orderIndex >= queueOrder.length) continue;
    const song = queue[queueOrder[orderIndex] ?? -1];
    if (!song) continue;
    if (offset === 0) currentIndex = songs.length;
    songs.push(toPrefetchSong(song, toSongKey(song.id)));
  }
  if (songs.length === 0) return null;
  const remainingS =
    state.playing && state.duration > 0
      ? Math.max(0, state.duration - state.position)
      : null;
  return { songs, currentIndex, remainingS, loopOne: state.loopMode === "one" };
};

/**
 * Residency is probed for the AUDIO candidates only - at most four songs (the
 * queue window plus the viewport centre). Artwork residency is not probed at
 * all: `prefetchArtwork` is idempotent and rides the image cache's own budget,
 * so a redundant call costs a map lookup, not a request.
 *
 * OUR OWN outstanding transfer is deliberately excluded. Marking it resident
 * would hide it from the policy, the next-best want would take rank 0, and
 * the supersede rule would cancel a perfectly good transfer to start a worse
 * one - then do the same in reverse on the following fire. Leaving it visible
 * is what lets "the rank 0 want equals the outstanding one" resolve to "do
 * nothing", which is the whole stability of the single-slot design.
 */
const residentSet = (
  h: PrefetchHost,
  queue: QueueSignal | null,
  center: PrefetchSong | null,
): Set<string> => {
  const out = new Set<string>();
  const mine = outstanding?.songKey ?? null;
  const consider = (song: PrefetchSong | null | undefined): void => {
    if (!song || song.jam) return;
    if (song.songKey === mine) return;
    if (h.resident(song.songKey, "mixed") || h.inFlight(song.songKey, "mixed")) {
      out.add(wantKey(song.songKey, "audio"));
    }
  };
  if (queue) {
    consider(queue.songs[queue.currentIndex - 1]);
    consider(queue.songs[queue.currentIndex]);
    consider(queue.songs[queue.currentIndex + 1]);
  }
  consider(center);
  return out;
};

// ---------------------------------------------------------------------------
// The fire
// ---------------------------------------------------------------------------

const cancelOutstanding = (): void => {
  if (!outstanding || !host) {
    outstanding = null;
    return;
  }
  host.cancelAudio(outstanding.songKey);
  outstanding = null;
};

const fire = (): void => {
  timer = null;
  const h = host;
  if (!h) return;

  // The outstanding slot self-heals here rather than through a completion
  // callback: the host owns the transfer, and a plain in-flight probe is
  // cheaper (and less racy) than a second event channel.
  if (outstanding && !h.inFlight(outstanding.songKey, "mixed")) outstanding = null;

  // EVERY gate is read here. An arm-time read would let a GO OFFLINE flip
  // land a transfer the user explicitly forbade.
  if (!prefetchAllowed(h.gates())) {
    cancelOutstanding();
    return;
  }

  const viewport = viewportSignal();
  const queue = queueSignal(playerStore.getState());
  const centerSong =
    collection && collection.songs.length > 0
      ? (collection.songs[
          Math.min(Math.max(viewport.centerIndex ?? 0, 0), collection.songs.length - 1)
        ] ?? null)
      : null;

  const wants = computeWants({
    collection,
    viewport,
    queue,
    resident: residentSet(h, queue, centerSong),
  });

  const artworkIds = wants.filter((w) => w.kind === "artwork").map((w) => w.mediaId);
  if (artworkIds.length > 0) h.prefetchArtwork(artworkIds);

  const audio = wants.find((w) => w.kind === "audio") ?? null;
  if (!audio) return;
  // The audio candidates can only ever come from the queue window (<= 3) or
  // the viewport centre (1), so resolving the source row is a four-element
  // scan, not a lookup table nobody would keep in sync.
  const audioSong = resolveAudioSong(audio.songKey, queue, centerSong);
  if (!audioSong) return;

  if (outstanding) {
    if (outstanding.songKey === audio.songKey) return;
    if (h.progressOf(outstanding.songKey) < SUPERSEDE_MIN_PROGRESS) {
      // Cancel is per (song, kind), NEVER cancelSong: the same song may be
      // carrying an explicit download of another kind at the same time.
      h.cancelAudio(outstanding.songKey);
      outstanding = null;
    } else {
      // Nearly paid for: let it land and take the new want afterwards. The
      // superseding want is deliberately NOT parked in a slot - re-arming and
      // RECOMPUTING is strictly more correct, because by the time those bytes
      // land the viewport (or the track) may well have moved on again.
      clearTimer();
      timer = setTimeout(fire, SUPERSEDE_DEBOUNCE_MS);
      return;
    }
  }

  outstanding = { songKey: audio.songKey, mediaId: audio.mediaId };
  h.startAudio(audio.songKey, audio.mediaId, audioSong);
};

const resolveAudioSong = (
  songKey: SongKey,
  queue: QueueSignal | null,
  center: PrefetchSong | null,
): Song | null => {
  if (center && center.songKey === songKey) return center.song;
  if (queue) {
    for (const song of queue.songs) {
      if (song.songKey === songKey) return song.song;
    }
  }
  return null;
};

// ---------------------------------------------------------------------------
// Queue subscription (outside React, quantised)
// ---------------------------------------------------------------------------

/**
 * Position updates at 4 Hz, i.e. ~800 store writes per track. Bucketing the
 * remaining seconds into 15 s steps wakes the driver at most ~4 times per
 * track, and only ONE of those buckets can flip `queue-next` on. No component
 * subscribes here, so none of it can render.
 */
const bucket = (remaining: number | null): number =>
  remaining == null ? -1 : Math.floor(remaining / 15);

const derivedQueueKey = (s: PlayerStoreState): string => {
  const remaining = s.playing && s.duration > 0 ? s.duration - s.position : null;
  return `${s.currentSong?.id ?? "none"}:${bucket(remaining)}:${s.loopMode}:${s.queueIndex}`;
};

const ensureQueueSubscription = (): void => {
  if (queueUnsubscribe) return;
  let lastKey = derivedQueueKey(playerStore.getState());
  queueUnsubscribe = playerStore.subscribe((state) => {
    const key = derivedQueueKey(state);
    if (key === lastKey) return;
    lastKey = key;
    schedule();
  });
};

// ---------------------------------------------------------------------------
// Test seam. Not used by the app; the driver holds process-wide state and a
// bun test that touched it would leak into the next one.
// ---------------------------------------------------------------------------

/** @internal */
export const __resetPrefetchDriverForTests = (): void => {
  stopPrefetch();
  host = null;
  queueUnsubscribe?.();
  queueUnsubscribe = null;
  outstanding = null;
};
