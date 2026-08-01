/**
 * Pure snapshot helpers (FR-109): slim state_changed merging and current-song
 * projection. Unit-tested in bun (DESIGN 17) - keep this module free of I/O.
 */
import type { PlaybackSnapshot } from "@/domain/playback";
import type { Song } from "@/domain/song";

/**
 * Slim `state_changed` broadcasts OMIT `queue_songs` whenever the queue
 * itself did not change (the full song blueprints are the heavy part).
 * Merge with the last full list or the controller UI empties on every
 * pause. A present-but-empty array counts as a full replacement.
 */
export const mergeSlimState = (
  incoming: PlaybackSnapshot,
  lastFullQueueSongs: Song[] | undefined,
): PlaybackSnapshot =>
  incoming.queue_songs
    ? incoming
    : { ...incoming, queue_songs: lastFullQueueSongs ?? [] };

/** The snapshot's audible song: queue_songs[queue_order[queue_index]]. */
export const snapshotCurrentSong = (snap: PlaybackSnapshot | null): Song | null => {
  if (!snap?.queue_songs) return null;
  const backing = snap.queue_order?.[snap.queue_index ?? 0];
  if (backing === undefined) return null;
  return snap.queue_songs[backing] ?? null;
};

/**
 * Wire song ids are strings; normalize defensively (a numeric leak upstream
 * must not silently break the tick song-match check).
 */
export const normalizeWireSongId = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);
