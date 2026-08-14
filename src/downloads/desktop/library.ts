/**
 * Offline browsing on desktop (FR-91): the same resolvers `offlineLibrary.ts`
 * registers on native, reading the Rust cache's pinned songs instead of
 * dl_songs.
 *
 * Every derivation - the filters, the album grouping, the artist synthesis,
 * the paging - is IMPORTED from `downloads/library.ts`, which is pure and
 * bun-tested. What is written here is only the argument dispatch, and that
 * cannot be shared: `offlineLibrary.ts` binds its resolvers to the native
 * manager at module scope, so calling them on desktop would read an empty
 * expo-sqlite session. Duplicating six `if` ladders is the smaller cost;
 * duplicating one line of filter logic would not be, and none is.
 */
import { registerOfflineResolver, setOfflineNowProvider } from "@/contracts/offlineFallback";
import { ARTISTS_PAGE_SIZE } from "@/api/endpoints/artists";
import { PLAYLIST_SONGS_PAGE_SIZE } from "@/api/endpoints/playlistSongs";
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
} from "../library";
import { isOffline, OfflineUnavailableError } from "../offlineLibrary";
import { collectionSongKeys } from "./collections";
import {
  downloadedPlaylists,
  getStoredLyrics,
  getStoredSong,
  listDownloadedSongs,
} from "./manager";

const EPOCH_ISO = new Date(0).toISOString();

const storedSongs = (): Song[] => listDownloadedSongs();

/** listSongs(filters) | listAlbumSongs(album) | listArtistSongs(name, role). */
const songsResolver = async (...args: unknown[]): Promise<Song[]> => {
  const songs = storedSongs();
  const [first, second] = args;

  if (typeof second === "string") {
    const name = typeof first === "string" ? first : "";
    return filterOfflineSongs(songs, {
      exact_search: { artist: name },
      artist_role: second as ArtistRoleFilter,
    });
  }
  if (args.length === 1 && (first === null || typeof first === "string")) {
    return sortAlbumSongs(filterOfflineSongs(songs, { exact_search: { album: first } }));
  }
  if (first && typeof first === "object") {
    return filterOfflineSongs(songs, first as OfflineSongQuery);
  }
  return songs;
};

/** listAlbums(filters) | listRandomAlbums(count). */
const albumsResolver = async (...args: unknown[]): Promise<AlbumSummary[]> => {
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

/** listArtistsPage(page, order) | searchArtists(name) | getArtist(idOrSlug). */
const artistsResolver = async (...args: unknown[]): Promise<Artist | Artist[]> => {
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

/** getLyrics(songId) over the Rust tri-state. */
const lyricsResolver = async (...args: unknown[]): Promise<Lyrics> => {
  const [songId] = args;
  if (typeof songId !== "number" && typeof songId !== "string") {
    throw new OfflineUnavailableError("lyrics");
  }
  const stored = await getStoredLyrics(songId);
  if (!stored) throw new OfflineUnavailableError("lyrics");
  // 'none' is a CONFIRMED miss: answer with the same all-null shape the
  // backend 200s with, so the empty state renders instead of an error and the
  // miss is never refetched.
  if (stored.state === "none") return { synced: null, plain: null, attribution: null };
  if (stored.state === "cached" && stored.lyrics) return stored.lyrics;
  throw new OfflineUnavailableError("lyrics");
};

const playlistFromRow = (row: ReturnType<typeof downloadedPlaylists>[number]): Playlist => ({
  id: row.id as Playlist["id"],
  created_at: EPOCH_ISO,
  updated_at: EPOCH_ISO,
  name: row.name,
  user_id: "" as Playlist["user_id"],
  artwork_media_id: row.artworkMediaId as Playlist["artwork_media_id"],
  // "manual" so no screen offers a sync action that cannot run offline.
  source_kind: "manual",
  source_provider: null,
  source_url: null,
  // Preserved so the liked MIRROR keeps its heart tile offline.
  source_external_id: row.sourceExternalId as Playlist["source_external_id"],
  synced_at: null,
});

const playlistsResolver = async (...args: unknown[]): Promise<Playlist | Playlist[]> => {
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
    const song = getStoredSong(songKey);
    if (song) out.push(song);
  }
  return out;
};

/**
 * Fabricated join rows over the persisted membership. Ids are NEGATIVE so they
 * can never collide with a real one (or with the optimistic placeholder id 0):
 * offline rows are for rendering and playing, never for
 * DELETE /playlist_songs/:id.
 */
const playlistSongsResolver = async (...args: unknown[]): Promise<PlaylistSong[]> => {
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

/** listLikedIds() | listLiked(cursor?) from the downloaded liked MIRROR. */
const likedResolver = async (...args: unknown[]): Promise<number[] | LikedSong[]> => {
  const mirror = downloadedPlaylists().find((row) => row.sourceExternalId === "liked");
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

let registered = false;

export const registerDesktopOfflineLibrary = (): void => {
  if (registered) return;
  registered = true;
  registerOfflineResolver("songs", songsResolver);
  registerOfflineResolver("albums", albumsResolver);
  registerOfflineResolver("artists", artistsResolver);
  registerOfflineResolver("lyrics", lyricsResolver);
  registerOfflineResolver("playlists", playlistsResolver);
  registerOfflineResolver("playlistSongs", playlistSongsResolver);
  registerOfflineResolver("liked", likedResolver);
  // The GO OFFLINE flag and the browser's online/offline events both compose
  // into this one predicate (downloads/offlineLibrary.ts is pure JS plus kv,
  // so the desktop fork reuses it verbatim rather than keeping a second flag).
  setOfflineNowProvider(isOffline);
};
