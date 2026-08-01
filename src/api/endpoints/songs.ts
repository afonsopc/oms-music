/**
 * Songs REST (API.md section 5). ALWAYS send explicit pages: a missing
 * modifiers[page] forces 1:500 server-side. `exact_search[album]="\b"`
 * (params null sentinel) is the unknown-album query. Never call
 * POST /songs/clean (dead) or GET /songs/artists (ignores filters).
 */
import { request, requestBinary } from "../client";
import { pageModifier } from "../params";
import type { ListFilters } from "@/domain/api";
import type { SongId } from "@/domain/ids";
import type { AlbumSummary } from "@/domain/album";
import type { Song } from "@/domain/song";

export type ArtistRole = "primary" | "featured" | "with";

export const listSongs = (
  filters: ListFilters & { artist_role?: ArtistRole } = {},
): Promise<Song[]> => request("GET", "/songs", { params: filters });

export const getSong = (id: SongId): Promise<Song> => request("GET", `/songs/${id}`);

/** Page of songs by title search (search suggestion candidates). */
export const searchSongsByTitle = (title: string, page = 1, size = 20): Promise<Song[]> =>
  listSongs({ search: { title }, modifiers: { page: pageModifier(page, size) } });

/** Songs of an album; album === null queries IS NULL via the sentinel. */
export const listAlbumSongs = (album: string | null): Promise<Song[]> =>
  listSongs({
    exact_search: { album },
    modifiers: { page: pageModifier(1, 500) },
  });

/** All songs where the named artist has the given role. */
export const listArtistSongs = (artistNameOrSlug: string, role: ArtistRole): Promise<Song[]> =>
  listSongs({
    exact_search: { artist: artistNameOrSlug },
    artist_role: role,
    modifiers: { page: pageModifier(1, 500) },
  });

/** Album summaries; NOT force-paginated but page anyway for bounded loads. */
export const listAlbums = (
  filters: ListFilters & { artist_role?: ArtistRole } = {},
): Promise<AlbumSummary[]> => request("GET", "/songs/albums", { params: filters });

export const listRandomAlbums = (count = 10): Promise<AlbumSummary[]> =>
  listAlbums({ modifiers: { random: true, page: pageModifier(1, count) } });

/** Deezer picture lookup for a bare artist name (derived search cards). */
export const getArtistPictures = (
  name: string,
): Promise<{
  pictures: {
    picture: string | null;
    picture_small: string | null;
    picture_medium: string | null;
    picture_big: string | null;
    picture_xl: string | null;
  }[];
}> => request("GET", "/songs/artist_pictures", { params: { name } });

/**
 * PATCH /songs/:id (FR-96). Multipart when artwork present, JSON otherwise.
 * `featured_artist_names[]` must ALWAYS be sent when editing artists - a
 * single empty string means "explicitly none"; an absent key triggers the
 * legacy "feat." title-reparse heuristic server-side.
 */
export interface SongPatch {
  title?: string;
  album?: string | null;
  year?: number | null;
  position?: number | null;
  artist_names?: string[];
  featured_artist_names?: string[];
}

export const updateSong = (
  id: SongId,
  patch: SongPatch,
  artwork?: { uri: string; name: string; type: string },
): Promise<Song> => {
  if (!artwork) return request("PATCH", `/songs/${id}`, { body: patch });
  const formData = new FormData();
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const entry of value) formData.append(`${key}[]`, entry);
    } else {
      // FormData cannot carry the "\b" rewrite; null fields clear via JSON
      // PATCH instead (callers split their requests accordingly).
      formData.append(key, value === null ? "\b" : String(value));
    }
  }
  formData.append("artwork", artwork as unknown as Blob);
  return request("PATCH", `/songs/${id}`, { formData });
};

export const deleteSong = (id: SongId): Promise<void> => request("DELETE", `/songs/${id}`);

/** Synchronous multipart import; lossless files take tens of seconds. */
export const importSongFile = (file: {
  uri: string;
  name: string;
  type: string;
}): Promise<Song> => {
  const formData = new FormData();
  formData.append("file", file as unknown as Blob);
  return request("POST", "/songs/import", { formData, timeoutMs: 300_000 });
};

/** FR-126 metadata modifier: returns the modified audio binary (50 MB cap). */
export const modifyMetadata = (
  audioFile: { uri: string; name: string; type: string },
  metadata: Partial<{
    title: string;
    artist: string;
    album: string;
    year: string;
    genre: string;
  }>,
  artwork?: { uri: string; name: string; type: string },
): Promise<Blob> => {
  const formData = new FormData();
  formData.append("audio_file", audioFile as unknown as Blob);
  for (const [key, value] of Object.entries(metadata)) {
    if (value !== undefined) formData.append(`metadata[${key}]`, value);
  }
  if (artwork) formData.append("metadata[artwork]", artwork as unknown as Blob);
  return requestBinary("POST", "/songs/metadata_modifier", { formData });
};
