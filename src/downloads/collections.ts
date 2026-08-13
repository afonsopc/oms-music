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
  isOfflineCollectionKey,
  isStarted,
  isWifiRefusedError,
  normalizeSongKey,
  removeDownload,
  removeOfflineCollection,
  rememberOfflinePlaylist,
  forgetOfflinePlaylist,
} from "./manager";
import { NOTICE_KEYS, notifyDownloadNotice } from "./notices";
import { getMixedStatus } from "./status";
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

/** Records the songs a collection currently holds (removal safety net). */
export const rememberCollectionSongs = (key: string, songs: readonly Song[]): void => {
  membership.set(key, new Set(songs.map((s) => normalizeSongKey(s.id))));
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
  for (const song of songs) {
    if (song.jam_song) continue;
    if (getMixedStatus(normalizeSongKey(song.id)) === "done") continue;
    try {
      await downloadSong(song);
    } catch (error) {
      if (isWifiRefusedError(error)) {
        notifyDownloadNotice(NOTICE_KEYS.wifiRefused);
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
  rememberCollectionSongs(key, songs);

  if (turningOn) {
    addOfflineCollection(key);
    notify();
    await downloadSongsSequentially(songs);
    notify();
    return;
  }

  removeOfflineCollection(key);
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
  syncing.add(key);
  try {
    for (const song of songs) {
      if (song.jam_song) continue;
      if (getMixedStatus(normalizeSongKey(song.id)) === "done") continue;
      try {
        await downloadSong(song);
      } catch (error) {
        if (isWifiRefusedError(error)) return; // Gate closed: try again later.
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
