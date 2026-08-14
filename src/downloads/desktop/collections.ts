/**
 * Offline collections on desktop (FR-87/93): the keep-synced toggle the
 * collection screens draw, plus the membership a cold offline launch needs.
 *
 * The native equivalent lives in `downloads/collections.ts`, which binds to
 * the expo-sqlite manager at module scope and therefore cannot be reused
 * here. What IS reused, verbatim, is the pure half of the keep-synced
 * watcher: `extractSongs` and `albumGroups` from `downloads/autoSync.ts`
 * already know how to read a react-query result and how the album screen keys
 * its collection, and re-deriving either would be a second truth about
 * screen keys.
 *
 * Discipline carried over from the 2026-08-14 freeze report:
 *  - membership is only re-persisted when its SIGNATURE changed. The
 *    query-settle watcher re-reports an identical list on every refetch, and
 *    rewriting N rows for an unchanged playlist was measurable freeze fuel;
 *  - the keep-synced pass never runs while offline (the GO OFFLINE override
 *    included): a silent pass must not fire doomed transfers.
 */
import type { Query, QueryKey } from "@tanstack/react-query";
import { queryClient } from "@/api/queryClient";
import type { SongKey } from "@/domain/ids";
import { toSongId, toSongKey } from "@/domain/ids";
import type { Playlist } from "@/domain/playlist";
import type { Song } from "@/domain/song";
import { albumGroups, extractSongs } from "../autoSync";
import { isOffline } from "../offlineLibrary";
import {
  cacheCollectionsAdd,
  cacheCollectionsList,
  cacheCollectionsRemove,
  cacheCollectionsSetSongs,
  cacheCollectionsSongs,
  cachePlaylistsRemove,
  cachePlaylistsUpsert,
} from "./bridge";
import {
  downloadSong,
  getStatusFor,
  isDesktopCacheOpen,
  removeDownload,
} from "./manager";

const collections = new Set<string>();
/** Persisted membership, mirrored in memory so the offline resolvers are sync. */
const membership = new Map<string, SongKey[]>();
/** Last-persisted signature per key: the write is skipped when it matches. */
const signatures = new Map<string, string>();
const listeners = new Set<() => void>();

const notify = (): void => {
  for (const cb of listeners) cb();
};

/** Coarse channel for the collection set (the ActionBar toggle reads it). */
export const subscribeDesktopCollections = (cb: () => void): (() => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

export const isOfflineCollection = (key: string): boolean => collections.has(key);

export const collectionSongKeys = (key: string): readonly SongKey[] =>
  membership.get(key) ?? [];

const normalizeSongKey = (id: number | string): SongKey =>
  typeof id === "number" ? toSongKey(id) : toSongKey(toSongId(id));

/** Reads the set and every membership list back out of the Rust index. */
export const hydrateDesktopCollections = async (): Promise<void> => {
  collections.clear();
  membership.clear();
  signatures.clear();
  try {
    const keys = await cacheCollectionsList();
    for (const key of keys) collections.add(key);
    for (const key of keys) {
      const songKeys = (await cacheCollectionsSongs(key)) as SongKey[];
      membership.set(key, songKeys);
      signatures.set(key, songKeys.join(","));
    }
  } catch {
    // An unopened cache: the toggles simply render off.
  }
  notify();
};

const persistMembership = (key: string, songKeys: SongKey[]): void => {
  const signature = songKeys.join(",");
  membership.set(key, songKeys);
  if (signatures.get(key) === signature) return;
  signatures.set(key, signature);
  void cacheCollectionsSetSongs(key, songKeys).catch(() => undefined);
};

/** True when some OTHER offline collection still needs this song. */
const neededElsewhere = (key: string, songKey: SongKey): boolean => {
  for (const [otherKey, keys] of membership) {
    if (otherKey === key) continue;
    if (!collections.has(otherKey)) continue;
    if (keys.includes(songKey)) return true;
  }
  return false;
};

/**
 * Sequential enqueue. There is no WiFi gate on desktop (no cellular radio to
 * bill), so unlike the native path this cannot refuse a whole batch; the only
 * per-song skip is "already downloaded", which is what makes a re-toggle
 * resume a partial sync instead of restarting it.
 */
const downloadSequentially = async (songs: readonly Song[]): Promise<void> => {
  for (const song of songs) {
    if (song.jam_song || song.audio_url) continue;
    // `getStatusFor`, NOT the raw kind status: an orphan row (the predictive
    // tier guessed right, or the play cache landed it) reports "none" here
    // precisely because it carries no `songs` row. Skipping on the raw status
    // would leave the song unpinned - evictable, invisible to the Downloads
    // screen and absent from the offline library - while the collection
    // claimed to have downloaded it. Rust dedups the bytes itself, so the
    // call costs a row write and nothing more.
    if (getStatusFor(song.id) === "done") continue;
    await downloadSong(song);
  }
};

export const toggleOfflineCollection = async (
  key: string,
  songs: readonly Song[],
): Promise<void> => {
  if (!isDesktopCacheOpen()) return;
  const turningOn = !collections.has(key);
  const songKeys = songs.map((s) => normalizeSongKey(s.id));

  if (turningOn) {
    collections.add(key);
    void cacheCollectionsAdd(key).catch(() => undefined);
    persistMembership(key, songKeys);
    notify();
    await downloadSequentially(songs);
    notify();
    return;
  }

  // Turning OFF never persists first: writing N rows just to delete them in
  // the next statement is the double-write the freeze audit flagged.
  collections.delete(key);
  signatures.delete(key);
  void cacheCollectionsRemove(key).catch(() => undefined);
  const numericId = Number(key);
  if (Number.isFinite(numericId) && String(numericId) === key) {
    void cachePlaylistsRemove(numericId).catch(() => undefined);
  }
  notify();
  for (const song of songs) {
    const songKey = normalizeSongKey(song.id);
    if (neededElsewhere(key, songKey)) continue;
    await removeDownload(songKey);
  }
  membership.delete(key);
  notify();
};

/**
 * Keep-synced pass: remembers the members and, when the collection is marked
 * offline, downloads whatever is missing. Silent by design (it runs off query
 * successes, not off a gesture) and idempotent. One pass per key at a time.
 */
const syncing = new Set<string>();

export const syncOfflineCollection = async (
  key: string,
  songs: readonly Song[],
): Promise<void> => {
  if (!isDesktopCacheOpen()) return;
  const songKeys = songs.map((s) => normalizeSongKey(s.id));
  if (collections.has(key)) persistMembership(key, songKeys);
  else membership.set(key, songKeys);
  if (!collections.has(key) || syncing.has(key)) return;
  if (isOffline()) return;
  syncing.add(key);
  try {
    await downloadSequentially(songs);
  } finally {
    syncing.delete(key);
  }
};

// ---------------------------------------------------------------------------
// Query-cache watchers
// ---------------------------------------------------------------------------

const handled = new WeakSet<object>();

const handleSongsQuery = (queryKey: QueryKey, data: unknown): void => {
  const key = queryKey as unknown[];
  if (key[0] === "playlistSongs" && typeof key[1] === "number") {
    void syncOfflineCollection(String(key[1]), extractSongs(data));
    return;
  }
  if (key[0] === "songs" && key[1] === "byAlbum") {
    for (const [collectionKey, songs] of albumGroups(extractSongs(data))) {
      void syncOfflineCollection(collectionKey, songs);
    }
  }
};

/**
 * The offline-playlist identity cache, populated from the playlists LIST query
 * rather than from the playlist screen.
 *
 * On native the screen calls `useOfflinePlaylistIdentity`, which routes into
 * the expo-sqlite manager and therefore does nothing here. Watching the query
 * cache reaches the same rows without touching a screen this partition does
 * not own, and it covers the liked mirror for free (the mirror is a playlist
 * row like any other, marked by `source_external_id`).
 *
 * Without these rows a cold airplane-mode launch knows WHICH songs a
 * downloaded playlist holds but cannot draw its name or its cover.
 */
const handlePlaylistsQuery = (queryKey: QueryKey, data: unknown): void => {
  const key = queryKey as unknown[];
  if (key[0] !== "playlists" || key[1] !== "list") return;
  if (!Array.isArray(data)) return;
  for (const row of data as Playlist[]) {
    if (!row || typeof row !== "object" || typeof row.id !== "number") continue;
    const collectionKey = String(row.id);
    if (!collections.has(collectionKey)) continue;
    void cachePlaylistsUpsert({
      id: row.id,
      name: row.name,
      artworkMediaId: row.artwork_media_id ?? null,
      songCount: membership.get(collectionKey)?.length ?? 0,
      sourceExternalId: row.source_external_id ?? null,
      updatedAt: Date.now(),
    }).catch(() => undefined);
  }
};

let stopWatcher: (() => void) | null = null;

/** Idempotent; the fork starts it once the cache session is open. */
export const startDesktopCollectionAutoSync = (): void => {
  if (stopWatcher) return;
  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" && event.type !== "added") return;
    const query = event.query as Query;
    if (query.state.status !== "success") return;
    const data = query.state.data;
    if (data && typeof data === "object") {
      // Successful fetches produce fresh references, so one walk per result.
      if (handled.has(data)) return;
      handled.add(data);
    }
    handleSongsQuery(query.queryKey, data);
    handlePlaylistsQuery(query.queryKey, data);
  });
  stopWatcher = () => {
    unsubscribe();
    stopWatcher = null;
  };
};

export const stopDesktopCollections = (): void => {
  stopWatcher?.();
  collections.clear();
  membership.clear();
  signatures.clear();
  syncing.clear();
  notify();
};
