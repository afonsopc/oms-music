/**
 * Offline browsing wiring (FR-91, FR-81 read half). Registers the resolvers
 * that answer library queries from the downloaded records, plus the global
 * `isOfflineNow` flag that lets wrapped query fns skip doomed network calls
 * (DESIGN 9.4). The derivations themselves live in downloads/library.ts
 * (pure, bun-tested); this module only bridges them to the manager and the
 * contracts seam.
 *
 * Artwork needs no separate resolver: ui/ArtworkImage already asks the
 * LocalFileIndex (contracts/localSource) for a downloaded artwork file, which
 * register.ts installs.
 */
import { registerOfflineResolver, setOfflineNowProvider } from "@/contracts/offlineFallback";
import { ARTISTS_PAGE_SIZE } from "@/api/endpoints/artists";
import type { AlbumSummary } from "@/domain/album";
import type { Artist } from "@/domain/artist";
import type { Lyrics } from "@/domain/lyrics";
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
import { getStoredLyrics, listDownloadedSongs } from "./manager";

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

let online = true;
const onlineListeners = new Set<(value: boolean) => void>();

export const setOnlineState = (value: boolean): void => {
  if (value === online) return;
  online = value;
  for (const cb of onlineListeners) cb(value);
};

export const isOnline = (): boolean => online;
export const isOffline = (): boolean => !online;

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
  setOfflineNowProvider(isOffline);
};
