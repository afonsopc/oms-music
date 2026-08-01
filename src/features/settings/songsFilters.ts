/**
 * Pure logic for the songs management screen (FR-96), bun-testable:
 * client-side filtering over the loaded pages, filter option builders,
 * server-search fold-in, and the artist-chip protocol.
 *
 * CRITICAL PROTOCOL (request-shape guarantee): `featured_artist_names[]` is
 * ALWAYS present in the artist params - a single empty string means
 * "explicitly none". Omitting the key flips the backend into its legacy
 * title-based "feat." reparse heuristic (the bug FR-96's AC guards against).
 */
import { formatArtists } from "@/domain/format";
import type { Song } from "@/domain/song";

export type ArtistChipRole = "primary" | "featured";

export interface ArtistChip {
  name: string;
  role: ArtistChipRole;
}

/** Pre-populates chips from the song_artists rows in position order (web
 *  parity incl. the legacy fallback: unroled lead = primary, rest featured). */
export const chipsFromSong = (song: Pick<Song, "artists">): ArtistChip[] => {
  const sorted = (song.artists ?? []).slice().sort((a, b) => a.position - b.position);
  return sorted.map((entry, idx) => {
    let role: ArtistChipRole;
    if (entry.role === "featured" || entry.role === "with") role = "featured";
    else if (entry.role === "primary") role = "primary";
    else role = idx === 0 ? "primary" : "featured";
    return { name: entry.name, role };
  });
};

export interface ArtistParams {
  artist_names: string[];
  featured_artist_names: string[];
}

/** Splits chips by role. The featured key is ALWAYS populated: a single ""
 *  when no featured artists exist (empty strings are stripped server-side). */
export const artistParamsFromChips = (chips: readonly ArtistChip[]): ArtistParams => {
  const primaries: string[] = [];
  const featured: string[] = [];
  for (const chip of chips) {
    const name = chip.name.trim();
    if (!name) continue;
    if (chip.role === "primary") primaries.push(name);
    else featured.push(name);
  }
  return {
    artist_names: primaries,
    featured_artist_names: featured.length === 0 ? [""] : featured,
  };
};

export interface SongFilterState {
  title: string;
  artist: string;
  album: string;
  origins: string[];
  qualities: string[];
  codecs: string[];
}

export const EMPTY_SONG_FILTERS: SongFilterState = {
  title: "",
  artist: "",
  album: "",
  origins: [],
  qualities: [],
  codecs: [],
};

export const hasTextFilter = (f: SongFilterState): boolean =>
  !!(f.title.trim() || f.artist.trim() || f.album.trim());

export const songOriginKey = (song: Pick<Song, "source_provider" | "source_kind">): string =>
  song.source_provider || song.source_kind || "upload";

export const filterSongs = (songs: readonly Song[], f: SongFilterState): Song[] => {
  const title = f.title.trim().toLowerCase();
  const artist = f.artist.trim().toLowerCase();
  const album = f.album.trim().toLowerCase();
  return songs.filter((song) => {
    if (title && !song.title.toLowerCase().includes(title)) return false;
    if (artist && !formatArtists(song).toLowerCase().includes(artist)) return false;
    if (album && !(song.album ?? "").toLowerCase().includes(album)) return false;
    if (f.origins.length > 0 && !f.origins.includes(songOriginKey(song))) return false;
    if (f.qualities.length > 0) {
      const quality = song.audio_lossless ? "lossless" : "lossy";
      if (!f.qualities.includes(quality)) return false;
    }
    if (f.codecs.length > 0) {
      const codec = song.audio_codec?.toLowerCase();
      if (!codec || !f.codecs.includes(codec)) return false;
    }
    return true;
  });
};

/** Option lists built from the data so only present values are offered. */
export const originOptions = (songs: readonly Song[]): string[] =>
  Array.from(new Set(songs.map(songOriginKey))).sort();

export const codecOptions = (songs: readonly Song[]): string[] =>
  Array.from(
    new Set(
      songs
        .map((s) => s.audio_codec?.toLowerCase())
        .filter((c): c is string => !!c),
    ),
  ).sort();

/** Folds server-search rows into the loaded pages without duplicates,
 *  keeping page order first (web useSongLibrarySearch parity). */
export const mergeLookups = (pages: readonly Song[], lookups: readonly Song[]): Song[] => {
  if (lookups.length === 0) return pages.slice();
  const byId = new Map<number, Song>(pages.map((song) => [song.id, song]));
  for (const song of lookups) {
    if (!byId.has(song.id)) byId.set(song.id, song);
  }
  return Array.from(byId.values());
};

export const dedupeById = (songs: readonly Song[]): Song[] => {
  const byId = new Map<number, Song>();
  for (const song of songs) if (!byId.has(song.id)) byId.set(song.id, song);
  return Array.from(byId.values());
};
