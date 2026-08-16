/**
 * Pure library derivations for offline browsing (FR-91). Songs, albums and
 * artists computed from downloaded Song payloads, plus the filter subset the
 * library screens actually send. Zero I/O so bun tests cover it directly;
 * downloads/offlineLibrary.ts wires these into the contracts resolvers.
 *
 * Album grouping uses the backend's (album, lead artist) compound key so an
 * offline album row navigates to the same screen an online one does.
 */
import type { AlbumSummary } from "@/domain/album";
import { isAlbumKey, isArtistKey } from "@/domain/albumKey";
import type { Artist } from "@/domain/artist";
import type { ListModifiers } from "@/domain/api";
import { primaryArtists } from "@/domain/format";
import type { SongKey } from "@/domain/ids";
import type { Song, SongArtistEntry } from "@/domain/song";
import type { OfflineCollectionSummary } from "./surface";

/** Accent- and case-insensitive comparison text (matches domain/rank). */
const normalize = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

export type ArtistRoleFilter = SongArtistEntry["role"];

/** The filter subset the offline resolvers understand. */
export interface OfflineSongQuery {
  search?: Record<string, unknown>;
  exact_search?: Record<string, unknown>;
  artist_role?: ArtistRoleFilter;
  modifiers?: ListModifiers;
}

export interface PageWindow {
  page: number;
  size: number;
}

/** Parses a `modifiers[page]` "N:SIZE" string. */
export const parsePageModifier = (page: string | undefined): PageWindow | null => {
  if (!page) return null;
  const [rawPage, rawSize] = page.split(":");
  const parsedPage = Number(rawPage);
  const parsedSize = Number(rawSize);
  if (!Number.isFinite(parsedPage) || !Number.isFinite(parsedSize)) return null;
  if (parsedPage < 1 || parsedSize < 1) return null;
  return { page: Math.floor(parsedPage), size: Math.floor(parsedSize) };
};

export const applyPageWindow = <T>(items: T[], window: PageWindow | null): T[] => {
  if (!window) return items;
  const start = (window.page - 1) * window.size;
  return items.slice(start, start + window.size);
};

/** Deterministic-enough shuffle for the offline random-albums rail. */
export const shuffled = <T>(items: T[]): T[] => {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

const entriesForRole = (song: Song, role: ArtistRoleFilter | undefined): SongArtistEntry[] => {
  const artists = song.artists ?? [];
  return role ? artists.filter((a) => a.role === role) : artists;
};

const artistMatches = (
  song: Song,
  value: string,
  role: ArtistRoleFilter | undefined,
  exact: boolean,
): boolean => {
  const needle = normalize(value);
  return entriesForRole(song, role).some((entry) => {
    const name = normalize(entry.name);
    const slug = normalize(entry.slug);
    if (exact) return name === needle || slug === needle;
    return name.includes(needle) || slug.includes(needle);
  });
};

const textMatches = (field: string | null, value: unknown, exact: boolean): boolean => {
  if (value === null) return field == null;
  if (typeof value !== "string") return true; // Unknown shape: do not filter.
  if (field == null) return false;
  return exact ? normalize(field) === normalize(value) : normalize(field).includes(normalize(value));
};

/**
 * Applies the filters the library screens actually send (title/album/artist
 * search, exact album/artist, artist_role) plus the page window. Unknown
 * keys are ignored rather than emptying the list: offline browsing degrades
 * to "everything downloaded" instead of "nothing".
 */
export const filterOfflineSongs = (songs: Song[], query: OfflineSongQuery = {}): Song[] => {
  let out = songs;
  const { search, exact_search: exact, artist_role: role } = query;

  if (search) {
    if ("title" in search) out = out.filter((s) => textMatches(s.title, search.title, false));
    if ("album" in search) out = out.filter((s) => textMatches(s.album, search.album, false));
    if ("artist" in search) {
      const value = search.artist;
      out =
        value === null
          ? out.filter((s) => entriesForRole(s, role).length === 0)
          : typeof value === "string"
            ? out.filter((s) => artistMatches(s, value, role, false))
            : out;
    }
  }

  if (exact) {
    if ("title" in exact) out = out.filter((s) => textMatches(s.title, exact.title, true));
    if ("album" in exact) out = out.filter((s) => textMatches(s.album, exact.album, true));
    if ("artist" in exact) {
      const value = exact.artist;
      out =
        value === null
          ? out.filter((s) => entriesForRole(s, role).length === 0)
          : typeof value === "string"
            ? out.filter((s) => artistMatches(s, value, role, true))
            : out;
    }
  } else if (role && !search?.artist) {
    out = out.filter((s) => entriesForRole(s, role).length > 0);
  }

  return applyPageWindow(out, parsePageModifier(query.modifiers?.page));
};

/** Album songs order the way the album screen expects (track position). */
export const sortAlbumSongs = (songs: Song[]): Song[] =>
  songs.slice().sort((a, b) => {
    const pa = a.position ?? Number.MAX_SAFE_INTEGER;
    const pb = b.position ?? Number.MAX_SAFE_INTEGER;
    if (pa !== pb) return pa - pb;
    return a.title.localeCompare(b.title);
  });

/**
 * One row per (album, lead-artist) pair - the backend's grouping key, so an
 * offline album row navigates to the same screen as an online one.
 */
export const deriveOfflineAlbums = (songs: Song[]): AlbumSummary[] => {
  const map = new Map<string, AlbumSummary>();
  for (const song of songs) {
    const primary = primaryArtists(song)[0] ?? null;
    const key = `${primary?.slug ?? ""}::${song.album ?? ""}`;
    if (map.has(key)) continue;
    map.set(key, {
      name: song.album ?? null,
      artist: primary?.name ?? null,
      artist_slug: primary?.slug ?? null,
      artwork_media_id: song.compressed_artwork_media_id ?? song.artwork_media_id ?? null,
    });
  }
  return [...map.values()].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
};

/** Artist rows synthesized from the song artist entries of downloaded songs. */
export const deriveOfflineArtists = (songs: Song[]): Artist[] => {
  const map = new Map<string, Artist>();
  const counts = new Map<string, number>();
  for (const song of songs) {
    for (const entry of primaryArtists(song)) {
      if (!entry.slug) continue;
      counts.set(entry.slug, (counts.get(entry.slug) ?? 0) + 1);
      if (map.has(entry.slug)) continue;
      map.set(entry.slug, {
        id: entry.artist_id,
        created_at: entry.created_at,
        updated_at: entry.updated_at,
        name: entry.name,
        canonical_name: entry.name,
        slug: entry.slug,
        user_id: song.user_id,
        image_media_id: entry.image_media_id,
        compressed_image_media_id: entry.compressed_image_media_id,
        banner_media_id: null,
        compressed_banner_media_id: null,
        mbid: null,
        lastfm_listeners: null,
        lastfm_playcount: null,
        external_image_url: entry.external_image_url,
        picture: entry.picture,
        picture_small: null,
        picture_medium: entry.picture_medium,
        picture_big: null,
        picture_xl: null,
        pictures_fetched_at: null,
        bio_fetched_at: null,
        similar_fetched_at: null,
        songs_count: 0,
        fallback_artwork_media_id: null,
      });
    }
  }
  return [...map.values()]
    .map((artist) => ({ ...artist, songs_count: counts.get(artist.slug) ?? 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

/**
 * A identidade de UMA colecção offline de álbum/artista, lida dos Songs que a
 * membership persistida aponta (handoff 2026-08-18). A chave só guarda partes
 * minúsculas ("album:<slug>:<album>" / "artist:<slug>"); a capitalização
 * verdadeira, a arte e o nome do artista vêm do primeiro Song pinado que
 * souber responder. Sem nenhum Song legível não há nada digno de desenhar e a
 * resposta é null - uma linha sem nome seria pior do que linha nenhuma.
 */
export const deriveCollectionIdentity = (
  key: string,
  songs: readonly Song[],
  songCount: number,
): OfflineCollectionSummary | null => {
  if (isAlbumKey(key)) {
    const first = songs.find((s) => s.album != null) ?? songs[0] ?? null;
    if (!first?.album) return null;
    const primary = primaryArtists(first)[0] ?? null;
    return {
      key,
      kind: "album",
      name: first.album,
      subtitle: primary?.name ?? null,
      artworkMediaId: first.compressed_artwork_media_id ?? first.artwork_media_id ?? null,
      songCount,
    };
  }
  if (isArtistKey(key)) {
    const slug = key.slice("artist:".length);
    let entry: SongArtistEntry | null = null;
    for (const song of songs) {
      entry = (song.artists ?? []).find((a) => a.slug.toLowerCase() === slug) ?? null;
      if (entry) break;
    }
    if (!entry) return null;
    return {
      key,
      kind: "artist",
      name: entry.name,
      subtitle: null,
      artworkMediaId: entry.compressed_image_media_id ?? entry.image_media_id ?? null,
      songCount,
    };
  }
  return null;
};

/**
 * As colecções de álbum/artista da overview, derivadas com os lookups da
 * plataforma (nativo: dl_songs + offline_collection_songs; desktop: os
 * espelhos em memória do índice Rust). Chaves de playlist são ignoradas -
 * essas têm a sua própria tabela de identidade (schema v2).
 */
export const deriveOfflineCollections = (
  keys: Iterable<string>,
  songKeysFor: (key: string) => readonly SongKey[],
  songFor: (songKey: SongKey) => Song | null,
): OfflineCollectionSummary[] => {
  const out: OfflineCollectionSummary[] = [];
  for (const key of keys) {
    if (!isAlbumKey(key) && !isArtistKey(key)) continue;
    const songKeys = songKeysFor(key);
    const songs: Song[] = [];
    for (const songKey of songKeys) {
      const song = songFor(songKey);
      if (song) songs.push(song);
    }
    const identity = deriveCollectionIdentity(key, songs, songKeys.length);
    if (identity) out.push(identity);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
};

/** True when the string identifies exactly this artist (detail lookup). */
export const matchesArtistIdentity = (artist: Artist, value: string): boolean => {
  const needle = normalize(value);
  return (
    String(artist.id) === value.trim() ||
    normalize(artist.slug) === needle ||
    normalize(artist.name) === needle
  );
};

export const searchOfflineArtists = (artists: Artist[], term: string): Artist[] => {
  const needle = normalize(term);
  if (!needle) return artists;
  return artists.filter(
    (a) => normalize(a.name).includes(needle) || normalize(a.slug).includes(needle),
  );
};

