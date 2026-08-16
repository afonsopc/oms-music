/**
 * Offline collections (FR-87). A collection is a client-side key -
 * `'<playlistId>'` for playlists, `albumKey(artistSlug, album)` for albums -
 * persisted in the frozen `offline_collections` table. Enabling downloads
 * every song sequentially (the manager's dedup makes a re-toggle resume a
 * partial sync); disabling removes them again.
 *
 * ActionBar semantics are keep-synced, not one-shot: `useOfflineCollectionSync`
 * runs on every collection query success, so songs added to an offline
 * playlist download themselves the next time the screen loads.
 *
 * Removal skips songs another offline collection still needs. Membership is
 * only knowable from the collection screens (the frozen DDL stores keys, not
 * members), so the map is session-scoped and filled as collections are seen:
 * worst case a shared song is removed and repair re-fetches it on the next
 * visit to the other collection.
 */
import { useEffect } from "react";
import {
  addOfflineCollection,
  downloadSong,
  forgetCollectionMembership,
  isOfflineCollectionKey,
  isStarted,
  isWifiRefusedError,
  normalizeSongKey,
  probeWifiGate,
  rememberCollectionMembership,
  removeDownload,
  removeOfflineCollection,
  rememberOfflinePlaylist,
  forgetOfflinePlaylist,
} from "./manager";
import { NOTICE_KEYS, notifyDownloadNotice } from "./notices";
import { isOffline } from "./offlineLibrary";
import { getMixedStatus } from "./status";
import { isStorageCapError } from "./storageCap";
import type { SongKey } from "@/domain/ids";
import type { Song } from "@/domain/song";

const membership = new Map<string, Set<SongKey>>();
const listeners = new Set<() => void>();

const notify = (): void => {
  for (const cb of listeners) cb();
};

/** Coarse channel for the collection set (WP6's ActionBar toggle). */
export const subscribeCollections = (cb: () => void): (() => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

export const isOfflineCollection = (key: string): boolean => isOfflineCollectionKey(key);

/** Last-persisted membership signature per key: the query-settle watcher
 *  re-reports identical lists on every refetch, and re-writing N rows for
 *  an unchanged playlist was freeze fuel (2026-08-14 report). */
const persistedSignatures = new Map<string, string>();

const persistMembership = (key: string, songKeys: readonly SongKey[]): void => {
  const signature = songKeys.join(",");
  if (persistedSignatures.get(key) === signature) return;
  persistedSignatures.set(key, signature);
  rememberCollectionMembership(key, songKeys);
};

/** Records the songs a collection currently holds (removal safety net).
 *  Offline collections ALSO persist the membership (schema v4) so a cold
 *  offline boot can rebuild the playlist screen from disk. */
export const rememberCollectionSongs = (key: string, songs: readonly Song[]): void => {
  const songKeys = songs.map((s) => normalizeSongKey(s.id));
  membership.set(key, new Set(songKeys));
  if (isOfflineCollectionKey(key)) persistMembership(key, songKeys);
};

/** True when some OTHER offline collection still needs this song. */
const neededElsewhere = (key: string, songKey: SongKey): boolean => {
  for (const [otherKey, keys] of membership) {
    if (otherKey === key) continue;
    if (!isOfflineCollectionKey(otherKey)) continue;
    if (keys.has(songKey)) return true;
  }
  return false;
};

/**
 * Sequential enqueue. Stops on a WiFi refusal (the gate is global, so the
 * next song would refuse too) and reports it once through the notice channel.
 */
export const downloadSongsSequentially = async (songs: readonly Song[]): Promise<void> => {
  // ONE gate probe for the whole batch: per-song NetInfo round-trips were
  // hundreds of native calls per pass (freeze report 2026-08-14).
  try {
    await probeWifiGate();
  } catch (error) {
    if (isWifiRefusedError(error)) {
      notifyDownloadNotice(NOTICE_KEYS.wifiRefused);
      return;
    }
  }
  for (const song of songs) {
    if (song.jam_song) continue;
    if (getMixedStatus(normalizeSongKey(song.id)) === "done") continue;
    try {
      await downloadSong(song, { skipWifiGate: true });
    } catch (error) {
      // O cap (FR-94) é global como o gate de WiFi: a próxima música ia
      // recusar igual, portanto um aviso e fim de loop, nunca N avisos.
      if (isStorageCapError(error)) {
        notifyDownloadNotice(NOTICE_KEYS.storageCapRefused);
        return;
      }
      notifyDownloadNotice(NOTICE_KEYS.enqueueFailed);
    }
  }
};

/** Keep-synced toggle: on = download everything and follow additions. */
export const toggleOfflineCollection = async (
  key: string,
  songs: readonly Song[],
): Promise<void> => {
  if (!isStarted()) return;
  const turningOn = !isOfflineCollectionKey(key);
  const songKeys = songs.map((s) => normalizeSongKey(s.id));
  membership.set(key, new Set(songKeys));

  if (turningOn) {
    addOfflineCollection(key);
    persistMembership(key, songKeys);
    notify();
    await downloadSongsSequentially(songs);
    notify();
    return;
  }

  // Turning OFF never persists first: writing N rows just to delete them in
  // the next statement was the double-write the freeze audit flagged.
  removeOfflineCollection(key);
  forgetCollectionMembership(key);
  persistedSignatures.delete(key);
  notify();
  for (const song of songs) {
    const songKey = normalizeSongKey(song.id);
    if (neededElsewhere(key, songKey)) continue;
    await removeDownload(songKey);
  }
  membership.delete(key);
  notify();
};

const syncing = new Set<string>();

/**
 * Keep-synced pass (FR-87): remembers the collection's members and, when the
 * collection is marked offline, enqueues whatever is not downloaded yet.
 * Silent by design (it runs off query successes, not off a user gesture) and
 * idempotent through the manager's dedup. One pass per key at a time.
 */
export const syncOfflineCollection = async (
  key: string,
  songs: readonly Song[],
): Promise<void> => {
  rememberCollectionSongs(key, songs);
  if (!isOfflineCollectionKey(key) || syncing.has(key)) return;
  // Effective-offline covers the GO OFFLINE override too: the silent pass
  // must not fire doomed (or unwanted) transfers; repair catches up later.
  if (isOffline()) return;
  syncing.add(key);
  try {
    try {
      await probeWifiGate(); // one probe per pass, not one per song
    } catch (error) {
      if (isWifiRefusedError(error)) return; // Gate closed: try again later.
    }
    for (const song of songs) {
      if (song.jam_song) continue;
      if (getMixedStatus(normalizeSongKey(song.id)) === "done") continue;
      try {
        await downloadSong(song, { skipWifiGate: true });
      } catch (error) {
        // O cap é global (FR-94): continuar o loop só martelava a recusa.
        // Este passo é silencioso por desenho, portanto pára sem aviso.
        if (isStorageCapError(error)) return;
        // Per-song enqueue failures stay silent here by design.
      }
    }
  } finally {
    syncing.delete(key);
  }
};

/**
 * Screen-level entry point for the same pass. Collection screens that already
 * hold their song list can call this instead of relying on the query-cache
 * watcher in downloads/autoSync.ts.
 */
export const useOfflineCollectionSync = (
  key: string | null | undefined,
  songs: readonly Song[] | undefined,
): void => {
  // The song array identity changes on every refetch; the id signature is
  // what actually matters for "did the collection gain songs".
  const signature = songs ? songs.map((s) => s.id).join(",") : "";
  useEffect(() => {
    if (!key || !songs || songs.length === 0) return;
    void syncOfflineCollection(key, songs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, signature]);
};

/** Test/lifecycle hygiene: drops the session-scoped membership map. */
export const resetCollectionMembership = (): void => {
  membership.clear();
};

/**
 * Caches a downloaded playlist's name and artwork (schema v2) so it can be
 * listed offline. Runs on the playlist screen while the data is fresh from the
 * network; a playlist that is not an offline collection is forgotten instead,
 * which also covers the user turning the download off.
 */
export const useOfflinePlaylistIdentity = (
  playlistId: number | null | undefined,
  name: string | null | undefined,
  artworkFsNodeId: string | null | undefined,
  songCount: number,
  sourceExternalId: string | null = null,
): void => {
  const offline = playlistId != null && isOfflineCollectionKey(String(playlistId));
  useEffect(() => {
    if (playlistId == null) return;
    if (!offline) {
      forgetOfflinePlaylist(playlistId);
      return;
    }
    if (!name) return;
    rememberOfflinePlaylist({
      id: playlistId,
      name,
      artwork_fs_node_id: artworkFsNodeId ?? null,
      song_count: songCount,
      source_external_id: sourceExternalId,
    });
  }, [playlistId, offline, name, artworkFsNodeId, songCount, sourceExternalId]);
};
