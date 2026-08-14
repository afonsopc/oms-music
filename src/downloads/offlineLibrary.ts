/**
 * Offline browsing wiring (FR-91, FR-81 read half). Registers the resolvers
 * that answer library queries from the downloaded records, plus the global
 * `isOfflineNow` flag that lets wrapped query fns skip doomed network calls
 * (DESIGN 9.4). The derivations themselves live in downloads/library.ts
 * (pure, bun-tested); this module only bridges them to the manager and the
 * contracts seam.
 *
 * Artwork needs no resolver registered HERE: ui/ArtworkImage asks the
 * LocalFileIndex (contracts/localSource) for a downloaded artwork file, both
 * by song id and by bare fs node id (the album/artist/rail form). The index
 * that answers both is installed by downloads/register.ts.
 */
import { registerOfflineResolver, setOfflineNowProvider } from "@/contracts/offlineFallback";
import { ARTISTS_PAGE_SIZE } from "@/api/endpoints/artists";
import { PLAYLIST_SONGS_PAGE_SIZE } from "@/api/endpoints/playlistSongs";
import { kvGet, kvSet } from "@/db/kv";
import type { AlbumSummary } from "@/domain/album";
import type { Artist } from "@/domain/artist";
import type { Lyrics } from "@/domain/lyrics";
import type { LikedSong, Playlist, PlaylistSong } from "@/domain/playlist";
import type { Song } from "@/domain/song";
import {
  applyPageWindow,
  deriveOfflineAlbums,
  deriveOfflineArtists,
  filterOfflineSongs,
  matchesArtistIdentity,
  parsePageModifier,
  searchOfflineArtists,
  shuffled,
  sortAlbumSongs,
  type ArtistRoleFilter,
  type OfflineSongQuery,
} from "./library";
import {
  collectionSongKeys,
  downloadedPlaylists,
  getStoredLyrics,
  getStoredSong,
  listDownloadedSongs,
} from "./manager";

/** Thrown when the downloaded library cannot answer a query at all. */
export class OfflineUnavailableError extends Error {
  constructor(what: string) {
    super(`Not available offline: ${what}`);
    this.name = "OfflineUnavailableError";
  }
}

// ---------------------------------------------------------------------------
// Online flag (FR-91). register.ts feeds it from NetInfo.
// ---------------------------------------------------------------------------

let netOnline = true;
/** The GO OFFLINE switch (owner request 2026-08-14): user-forced offline
 *  that composes with (and survives) every NetInfo event. Persisted in kv:
 *  Spotify semantics, an offline toggle survives an app restart. */
let manualOffline = false;
const MANUAL_OFFLINE_KV_KEY = "oms-music.downloads.manual-offline";
const onlineListeners = new Set<(value: boolean) => void>();
const manualListeners = new Set<() => void>();

/** register.ts calls this BEFORE the first NetInfo event so an offline boot
 *  never flashes online. Idempotent. */
export const hydrateManualOffline = (): void => {
  if (kvGet(MANUAL_OFFLINE_KV_KEY) === "1") setManualOffline(true);
};

const effectiveOnline = (): boolean => netOnline && !manualOffline;

const notifyOnline = (previous: boolean): void => {
  const now = effectiveOnline();
  if (now === previous) return;
  for (const cb of onlineListeners) cb(now);
};

export const setOnlineState = (value: boolean): void => {
  const previous = effectiveOnline();
  netOnline = value;
  notifyOnline(previous);
};

export const setManualOffline = (value: boolean): void => {
  if (manualOffline === value) return;
  const previous = effectiveOnline();
  manualOffline = value;
  kvSet(MANUAL_OFFLINE_KV_KEY, value ? "1" : "0");
  for (const cb of manualListeners) cb();
  notifyOnline(previous);
};

export const isManualOffline = (): boolean => manualOffline;

export const subscribeManualOffline = (cb: () => void): (() => void) => {
  manualListeners.add(cb);
  return () => {
    manualListeners.delete(cb);
  };
};

export const isOnline = (): boolean => effectiveOnline();
export const isOffline = (): boolean => !effectiveOnline();

export const subscribeOnlineState = (cb: (value: boolean) => void): (() => void) => {
  onlineListeners.add(cb);
  return () => {
    onlineListeners.delete(cb);
  };
};

// ---------------------------------------------------------------------------
// Resolvers (contracts/offlineFallback). One resolver per key must serve
// every wrapped primary that shares the key, so each dispatches on the
// argument shape of its call sites in src/api/queries.
// ---------------------------------------------------------------------------

const storedSongs = (): Song[] => listDownloadedSongs();

/** listSongs(filters) | listAlbumSongs(album) | listArtistSongs(name, role). */
export const offlineSongsResolver = async (...args: unknown[]): Promise<Song[]> => {
  const songs = storedSongs();
  const [first, second] = args;

  if (typeof second === "string") {
    // listArtistSongs(artistNameOrSlug, role)
    const name = typeof first === "string" ? first : "";
    return filterOfflineSongs(songs, {
      exact_search: { artist: name },
      artist_role: second as ArtistRoleFilter,
    });
  }

  if (args.length === 1 && (first === null || typeof first === "string")) {
    // listAlbumSongs(album) - null is the unknown-album query.
    return sortAlbumSongs(filterOfflineSongs(songs, { exact_search: { album: first } }));
  }

  if (first && typeof first === "object") {
    return filterOfflineSongs(songs, first as OfflineSongQuery);
  }

  return songs;
};

/** listAlbums(filters) | listRandomAlbums(count). */
export const offlineAlbumsResolver = async (...args: unknown[]): Promise<AlbumSummary[]> => {
  const [first] = args;
  if (typeof first === "number") {
    return shuffled(deriveOfflineAlbums(storedSongs())).slice(0, first);
  }
  const query = (first && typeof first === "object" ? first : {}) as OfflineSongQuery;
  const albums = deriveOfflineAlbums(
    filterOfflineSongs(storedSongs(), { ...query, modifiers: undefined }),
  );
  const window = parsePageModifier(query.modifiers?.page);
  return applyPageWindow(query.modifiers?.random ? shuffled(albums) : albums, window);
};

/**
 * listArtistsPage(page, order) | searchArtists(name) | getArtist(idOrSlug).
 *
 * The last two share an arity, so a single string that identifies an artist
 * exactly (numeric id, slug or full name) is treated as the detail lookup and
 * anything else as a search term. Known contract gap: an offline search whose
 * term is EXACTLY an artist name resolves as a detail (WP8 issue log).
 */
export const offlineArtistsResolver = async (...args: unknown[]): Promise<Artist | Artist[]> => {
  const artists = deriveOfflineArtists(storedSongs());
  const [first, second] = args;

  if (typeof first === "number") {
    const order = typeof second === "string" ? second : "name:asc";
    const ordered =
      order === "created_at:desc"
        ? artists.slice().sort((a, b) => b.created_at.localeCompare(a.created_at))
        : artists;
    return applyPageWindow(ordered, { page: first, size: ARTISTS_PAGE_SIZE });
  }

  if (typeof first === "string") {
    const exact = artists.find((a) => matchesArtistIdentity(a, first));
    if (exact) return exact;
    return searchOfflineArtists(artists, first);
  }

  return artists;
};

/** getLyrics(songId) - the FR-81 read half over the dl_songs tri-state. */
export const offlineLyricsResolver = async (...args: unknown[]): Promise<Lyrics> => {
  const [songId] = args;
  if (typeof songId !== "number" && typeof songId !== "string") {
    throw new OfflineUnavailableError("lyrics");
  }
  const stored = getStoredLyrics(songId);
  if (!stored) throw new OfflineUnavailableError("lyrics");
  // 'none' is a confirmed miss: answer with the same all-null shape the
  // backend 200s with so the empty state renders instead of an error, and
  // the miss is never refetched. 'unfetched' has no offline answer, so the
  // query surfaces its normal offline error and repair refetches later.
  if (stored.state === "none") return { synced: null, plain: null, attribution: null };
  if (stored.state === "cached" && stored.lyrics) return stored.lyrics;
  throw new OfflineUnavailableError("lyrics");
};

let registered = false;

/** Installs the resolvers + the offline flag provider (register.ts). */
export const registerOfflineLibrary = (): void => {
  if (registered) return;
  registered = true;
  registerOfflineResolver("songs", offlineSongsResolver);
  registerOfflineResolver("albums", offlineAlbumsResolver);
  registerOfflineResolver("artists", offlineArtistsResolver);
  registerOfflineResolver("lyrics", offlineLyricsResolver);
  registerOfflineResolver("playlists", offlinePlaylistsResolver);
  registerOfflineResolver("playlistSongs", offlinePlaylistSongsResolver);
  registerOfflineResolver("liked", offlineLikedResolver);
  setOfflineNowProvider(isOffline);
};

const EPOCH_ISO = new Date(0).toISOString();

const playlistFromRow = (row: ReturnType<typeof downloadedPlaylists>[number]): Playlist => ({
  id: row.id as Playlist["id"],
  created_at: EPOCH_ISO,
  updated_at: EPOCH_ISO,
  name: row.name,
  user_id: "" as Playlist["user_id"],
  artwork_fs_node_id: (row.artwork_fs_node_id ?? null) as Playlist["artwork_fs_node_id"],
  source_kind: "manual",
  source_provider: null,
  source_url: null,
  // Preserved so the liked-MIRROR keeps its heart tile offline (v3).
  source_external_id: (row.source_external_id ?? null) as Playlist["source_external_id"],
  synced_at: null,
});

/**
 * listPlaylists(filters) | getPlaylist(id) offline: the playlists whose
 * collection is downloaded, from the schema v2 cache. Fields the cache cannot
 * know are filled with values a playlist row renders happily without, and
 * `source_kind` stays "manual" so no screen offers a sync action that cannot
 * run without a network. A single number/string arg is the detail lookup.
 */
export const offlinePlaylistsResolver = async (
  ...args: unknown[]
): Promise<Playlist | Playlist[]> => {
  const rows = downloadedPlaylists();
  const [first] = args;
  if (typeof first === "number" || typeof first === "string") {
    const row = rows.find((r) => String(r.id) === String(first));
    if (!row) throw new OfflineUnavailableError(`playlist ${String(first)}`);
    return playlistFromRow(row);
  }
  return rows.map(playlistFromRow);
};

/** The downloaded songs of an offline collection, in persisted screen order. */
const storedCollectionSongs = (collectionKey: string): Song[] => {
  const out: Song[] = [];
  for (const songKey of collectionSongKeys(collectionKey)) {
    const stored = getStoredSong(songKey);
    if (stored) out.push(stored.song);
  }
  return out;
};

/**
 * listPlaylistSongsPage(playlistId, page) offline: fabricated join rows over
 * the persisted membership (schema v4). Join-row ids are NEGATIVE so they can
 * never collide with a real id (or the optimistic placeholder id 0) - offline
 * rows are for rendering and playing, never for DELETE /playlist_songs/:id.
 */
export const offlinePlaylistSongsResolver = async (
  ...args: unknown[]
): Promise<PlaylistSong[]> => {
  const [playlistId, page] = args;
  if (typeof playlistId !== "number" && typeof playlistId !== "string") {
    throw new OfflineUnavailableError("playlist songs");
  }
  const songs = storedCollectionSongs(String(playlistId));
  if (songs.length === 0) throw new OfflineUnavailableError(`playlist ${String(playlistId)}`);
  const pageNumber = typeof page === "number" && page > 0 ? page : 1;
  const start = (pageNumber - 1) * PLAYLIST_SONGS_PAGE_SIZE;
  return songs.slice(start, start + PLAYLIST_SONGS_PAGE_SIZE).map((song, i) => ({
    id: -(start + i + 1),
    created_at: EPOCH_ISO,
    updated_at: EPOCH_ISO,
    playlist_id: playlistId as PlaylistSong["playlist_id"],
    song_id: song.id,
    position: start + i + 1,
    song,
  }));
};

/**
 * listLikedIds() | listLiked(cursor?) offline, answered from the downloaded
 * liked-MIRROR playlist (source_external_id "liked" - the one liked surface
 * that is downloadable). Argument shapes: no args = ids; one nullish arg =
 * first page (everything at once); a cursor = "no more pages".
 */
export const offlineLikedResolver = async (
  ...args: unknown[]
): Promise<number[] | LikedSong[]> => {
  const mirror = downloadedPlaylists().find((row) => row.source_external_id === "liked");
  if (!mirror) throw new OfflineUnavailableError("liked songs");
  const songs = storedCollectionSongs(String(mirror.id));
  if (args.length === 0) return songs.map((song) => Number(song.id));
  if (args[0] != null) return []; // cursor page: the first page had everything
  return songs.map((song, i) => ({
    id: -(i + 1),
    created_at: EPOCH_ISO,
    updated_at: EPOCH_ISO,
    user_id: "" as LikedSong["user_id"],
    song_id: song.id,
    liked_at: EPOCH_ISO,
    song,
  }));
};
