/**
 * The queue quartet operations (FR-57), ported verbatim from the web
 * MusicProvider. Pure `(state, args) -> state`, no I/O, property-tested.
 * The audible song is queue[queueOrder[queueIndex]]; queueIndex indexes
 * queueOrder, NOT queue. Every operation owns its splice - nothing rebuilds
 * queueOrder reactively from the shuffle flag.
 */
import type { LoopMode, QueueState } from "@/domain/playback";
import type { Song } from "@/domain/song";

export const identityOrder = (length: number): number[] =>
  Array.from({ length }, (_, i) => i);

export const clampIndex = (index: number, length: number): number =>
  length === 0 ? 0 : Math.min(Math.max(0, index), length - 1);

export const isPermutation = (order: readonly number[], length: number): boolean => {
  if (order.length !== length) return false;
  const seen = new Array<boolean>(length).fill(false);
  for (const idx of order) {
    if (!Number.isInteger(idx) || idx < 0 || idx >= length || seen[idx]) return false;
    seen[idx] = true;
  }
  return true;
};

/** Fisher-Yates over a copy; rng injectable for deterministic tests. */
export const shuffleArray = <T>(items: readonly T[], rng: () => number = Math.random): T[] => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
};

export const currentSongOf = (state: QueueState): Song | null =>
  state.queue[state.queueOrder[state.queueIndex] ?? -1] ?? null;

export const emptyQueueState = (): QueueState => ({
  queue: [],
  queueOrder: [],
  queueIndex: 0,
  shuffle: false,
});

/**
 * Replace the queue. Order = identity, or a full shuffle of identity when
 * shuffle is on; index 0. When `startIndex` (a BACKING index into songs) is
 * given: shuffle off -> index = its natural position; shuffle on -> that
 * song moves to the front of the shuffled order (mirrors setShuffle ON).
 */
export const setQueue = (
  songs: Song[],
  shuffle: boolean,
  startIndex?: number,
  rng: () => number = Math.random,
): QueueState => {
  const ids = identityOrder(songs.length);
  if (!shuffle) {
    return {
      queue: songs,
      queueOrder: ids,
      queueIndex: startIndex !== undefined ? clampIndex(startIndex, songs.length) : 0,
      shuffle: false,
    };
  }
  if (startIndex === undefined || songs.length === 0) {
    return { queue: songs, queueOrder: shuffleArray(ids, rng), queueIndex: 0, shuffle: true };
  }
  const start = clampIndex(startIndex, songs.length);
  const rest = ids.filter((i) => i !== start);
  return {
    queue: songs,
    queueOrder: [start, ...shuffleArray(rest, rng)],
    queueIndex: 0,
    shuffle: true,
  };
};

export const setQueueIndex = (state: QueueState, visibleIndex: number): QueueState => ({
  ...state,
  queueIndex: clampIndex(visibleIndex, state.queueOrder.length),
});

/**
 * The ONLY reshuffle point. ON: current song to the front, rest shuffled,
 * index 0. OFF: identity order, index follows the current song to its
 * natural position. Same-value toggle is a no-op; empty queue just flips.
 */
export const setShuffle = (
  state: QueueState,
  on: boolean,
  rng: () => number = Math.random,
): QueueState => {
  if (on === state.shuffle) return state;
  if (state.queue.length === 0) return { ...state, shuffle: on };
  const currentIdx = state.queueOrder[state.queueIndex];
  if (on) {
    if (currentIdx === undefined) {
      return {
        ...state,
        shuffle: true,
        queueOrder: shuffleArray(identityOrder(state.queue.length), rng),
        queueIndex: 0,
      };
    }
    const rest = identityOrder(state.queue.length).filter((i) => i !== currentIdx);
    return {
      ...state,
      shuffle: true,
      queueOrder: [currentIdx, ...shuffleArray(rest, rng)],
      queueIndex: 0,
    };
  }
  return {
    ...state,
    shuffle: false,
    queueOrder: identityOrder(state.queue.length),
    queueIndex: clampIndex(currentIdx ?? 0, state.queue.length),
  };
};

/** Append to queue AND to the end of order. */
export const addToQueue = (state: QueueState, song: Song): QueueState => ({
  ...state,
  queue: [...state.queue, song],
  queueOrder: [...state.queueOrder, state.queue.length],
});

/** Append to queue; splice its backing index into order at queueIndex + 1. */
export const playNext = (state: QueueState, song: Song): QueueState => {
  const newIdx = state.queue.length;
  const pos = Math.min(state.queueIndex + 1, state.queueOrder.length);
  return {
    ...state,
    queue: [...state.queue, song],
    queueOrder: [...state.queueOrder.slice(0, pos), newIdx, ...state.queueOrder.slice(pos)],
  };
};

/**
 * Move within order (VISIBLE indices) with the exact cursor fixups: moved
 * current row -> index follows; from before to at/after cursor -> index - 1;
 * from after to at/before -> index + 1.
 */
export const reorderQueue = (
  state: QueueState,
  fromVisible: number,
  toVisible: number,
): QueueState => {
  if (fromVisible === toVisible) return state;
  if (
    fromVisible < 0 ||
    fromVisible >= state.queueOrder.length ||
    toVisible < 0 ||
    toVisible >= state.queueOrder.length
  ) {
    return state;
  }
  const newOrder = state.queueOrder.slice();
  const [moved] = newOrder.splice(fromVisible, 1);
  newOrder.splice(toVisible, 0, moved!);
  let newIndex = state.queueIndex;
  if (state.queueIndex === fromVisible) {
    newIndex = toVisible;
  } else if (fromVisible < state.queueIndex && toVisible >= state.queueIndex) {
    newIndex = state.queueIndex - 1;
  } else if (fromVisible > state.queueIndex && toVisible <= state.queueIndex) {
    newIndex = state.queueIndex + 1;
  }
  return { ...state, queueOrder: newOrder, queueIndex: newIndex };
};

/**
 * Remove a visible row. REFUSES the current row (no-op). Removes the order
 * entry and the backing entry, remaps every order value above the removed
 * backing index down by one, decrements the cursor when the removed visible
 * row was before it.
 */
export const removeFromQueue = (state: QueueState, visibleIndex: number): QueueState => {
  if (visibleIndex < 0 || visibleIndex >= state.queueOrder.length) return state;
  if (visibleIndex === state.queueIndex) return state;
  const removedSongIdx = state.queueOrder[visibleIndex]!;
  const newOrder = state.queueOrder.filter((_, i) => i !== visibleIndex);
  const newQueue = state.queue.filter((_, i) => i !== removedSongIdx);
  const remappedOrder = newOrder.map((idx) => (idx > removedSongIdx ? idx - 1 : idx));
  return {
    ...state,
    queue: newQueue,
    queueOrder: remappedOrder,
    queueIndex: visibleIndex < state.queueIndex ? state.queueIndex - 1 : state.queueIndex,
  };
};

/**
 * Snapshot sanitisation (used on EVERY snapshot adoption): jam proposals are
 * DROPPED (their presigned URLs never survive a session) with order/index
 * remapped around them; a non-permutation order falls back to identity; the
 * index is clamped. Ported verbatim from the web sanitiseQueueState.
 */
export const sanitizeSnapshot = (
  queueSongs: unknown,
  order: unknown,
  index: unknown,
  shuffle?: unknown,
): QueueState => {
  const rawQueue = Array.isArray(queueSongs) ? (queueSongs as Song[]) : [];
  const remap = new Map<number, number>();
  const queue: Song[] = [];
  rawQueue.forEach((entry, i) => {
    if (!entry || typeof entry !== "object" || entry.jam_song) return;
    remap.set(i, queue.length);
    queue.push(entry);
  });
  const rawOrder = Array.isArray(order) ? (order as unknown[]) : [];
  const rawIndex = typeof index === "number" && Number.isInteger(index) ? index : 0;
  const shuffleOn = shuffle === true;
  const queueOrder: number[] = [];
  // Kept entries before the saved position: if the current song survives the
  // filter this is exactly its new position; if it was a dropped proposal the
  // index lands on the next surviving song.
  let keptBefore = 0;
  rawOrder.forEach((value, pos) => {
    const mapped = typeof value === "number" ? remap.get(value) : undefined;
    if (mapped === undefined) return;
    if (pos < rawIndex) keptBefore++;
    queueOrder.push(mapped);
  });
  if (!isPermutation(queueOrder, queue.length)) {
    return {
      queue,
      queueOrder: identityOrder(queue.length),
      queueIndex: clampIndex(rawIndex, queue.length),
      shuffle: shuffleOn,
    };
  }
  return {
    queue,
    queueOrder,
    queueIndex: clampIndex(keptBefore, queue.length),
    shuffle: shuffleOn,
  };
};

/**
 * Insert a jam proposal after the current song, BEHIND earlier pending
 * proposals (FIFO scan of contiguous jam_song entries after the cursor).
 */
export const insertJamProposal = (state: QueueState, song: Song): QueueState => {
  const newIdx = state.queue.length;
  let pos = Math.min(state.queueIndex + 1, state.queueOrder.length);
  while (pos < state.queueOrder.length && state.queue[state.queueOrder[pos]!]?.jam_song) pos++;
  return {
    ...state,
    queue: [...state.queue, song],
    queueOrder: [...state.queueOrder.slice(0, pos), newIdx, ...state.queueOrder.slice(pos)],
  };
};

/**
 * FR-58 next: index + 1, wrap under All else clamp. `restart: true` means
 * the computed index equals the current one (single-song queue under All):
 * the engine restarts the source and plays instead of a state no-op.
 */
export const nextIndex = (
  state: QueueState,
  loop: LoopMode,
): { index: number; restart: boolean } | null => {
  if (state.queueOrder.length === 0) return null;
  let index = state.queueIndex + 1;
  if (index >= state.queueOrder.length) {
    if (loop !== "all") {
      const clamped = state.queueOrder.length - 1;
      return clamped === state.queueIndex ? null : { index: clamped, restart: false };
    }
    index = 0;
  }
  if (index === state.queueIndex) {
    return loop === "all" ? { index, restart: true } : null;
  }
  return { index, restart: false };
};

/**
 * FR-58 previous, Spotify-style: position > 3 s (or first entry under
 * LoopMode.None) -> restart; else index - 1, wrap only under All; a wrap
 * that lands on the same entry restarts too.
 */
export const previousIndex = (
  state: QueueState,
  loop: LoopMode,
  position: number,
): { restart: true } | { restart: false; index: number } => {
  const pastRestartWindow = position > 3;
  const firstAndNotLooping = loop === "none" && state.queueIndex === 0;
  if (pastRestartWindow || firstAndNotLooping) return { restart: true };
  let index = state.queueIndex - 1;
  if (index < 0) index = loop === "all" ? state.queueOrder.length - 1 : 0;
  if (index === state.queueIndex) return { restart: true };
  return { restart: false, index };
};
