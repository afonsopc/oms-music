/**
 * Keep-synced watcher (FR-87: "a song added to an offline playlist downloads
 * itself on the next open"). The collection screens are owned by another
 * package and hold no downloads code, so instead of a hook they have to call,
 * this watches the react-query cache: every successful playlist-songs or
 * album-songs query is matched against the offline-collection set and the
 * missing songs are enqueued.
 *
 * Cheap by construction: it only inspects two key shapes, and each result
 * object is walked once (successful fetches produce fresh references).
 */
import type { Query, QueryKey } from "@tanstack/react-query";
import { queryClient } from "@/api/queryClient";
import { albumKey } from "@/domain/albumKey";
import { primaryArtistSlug } from "@/domain/format";
import type { Song } from "@/domain/song";
import { syncOfflineCollection } from "./collections";

const handled = new WeakSet<object>();

/** Song[] | PlaylistSong[] | InfiniteData of either. */
export const extractSongs = (data: unknown): Song[] => {
  const rows: unknown[] = [];
  if (Array.isArray(data)) {
    rows.push(...data);
  } else if (data && typeof data === "object" && Array.isArray((data as { pages?: unknown }).pages)) {
    for (const page of (data as { pages: unknown[] }).pages) {
      if (Array.isArray(page)) rows.push(...page);
    }
  }

  const songs: Song[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const candidate = "song" in row ? (row as { song: unknown }).song : row;
    if (candidate && typeof candidate === "object" && typeof (candidate as Song).id === "number") {
      songs.push(candidate as Song);
    }
  }
  return songs;
};

/** Groups album-query results the way the album screen keys its collection. */
export const albumGroups = (songs: Song[]): Map<string, Song[]> => {
  const groups = new Map<string, Song[]>();
  for (const song of songs) {
    const key = albumKey(primaryArtistSlug(song), song.album);
    const bucket = groups.get(key);
    if (bucket) bucket.push(song);
    else groups.set(key, [song]);
  }
  return groups;
};

const handleQuery = (queryKey: QueryKey, data: unknown): void => {
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

let stop: (() => void) | null = null;

/** Idempotent; register.ts starts it at boot. Returns the unsubscribe. */
export const startCollectionAutoSync = (): (() => void) => {
  if (stop) return stop;
  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" && event.type !== "added") return;
    const query = event.query as Query;
    if (query.state.status !== "success") return;
    const data = query.state.data;
    if (data && typeof data === "object") {
      if (handled.has(data)) return;
      handled.add(data);
    }
    handleQuery(query.queryKey, data);
  });
  stop = () => {
    unsubscribe();
    stop = null;
  };
  return stop;
};
