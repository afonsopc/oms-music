/**
 * Pure search-result shaping (FR-30, FR-33). No I/O and no React so the
 * ranking rules are unit-testable: the backend LIKE-matches and returns
 * rows ALPHABETICALLY, so every list is re-ranked client-side before a
 * single row is drawn - without it "carlos" leads with "Agrupamento
 * Escolas D. Carlos I" and buries "Carlos Paiao".
 */
import type { Href } from "expo-router";
import type { AlbumSummary } from "@/domain/album";
import { artistDisplayName, artistRouteSegment } from "@/domain/album";
import type { Artist } from "@/domain/artist";
import { artistNamesList, primaryArtists } from "@/domain/format";
import type { Playlist } from "@/domain/playlist";
import { rankByMatch } from "@/domain/rank";
import type { Song } from "@/domain/song";
import { albumRoute } from "@/lib/routes";

/** Top 3 per kind in the suggestion dropdown (web MAX_PER_KIND). */
export const MAX_SUGGESTIONS_PER_KIND = 3;

export interface SearchAlbumHit {
  name: string;
  /** Display name of the album artist (may be a legacy bare string). */
  artist: string | null;
  /** Route segment, RAW: artist_slug when the backend knows it, else the name. */
  artistSegment: string | null;
  artworkFsNodeId: string | null;
}

export interface SearchArtistEntry {
  name: string;
  /** Route segment, RAW: roster slug when known, else the plain name. */
  segment: string;
  /** Present only for direct /artists hits (enables the image chain). */
  artist?: Artist;
}

export type SearchFilter = "all" | "songs" | "playlists" | "albums" | "artists";

export type TopResult =
  | { kind: "song"; song: Song }
  | { kind: "artist"; entry: SearchArtistEntry }
  | { kind: "album"; album: SearchAlbumHit }
  | { kind: "playlist"; playlist: Playlist };

export type SearchSuggestion = TopResult;

/** Album summaries -> ranked, name-bearing hits (nameless rows are dropped). */
export const toAlbumHits = (albums: AlbumSummary[], term: string): SearchAlbumHit[] =>
  rankByMatch(
    albums
      .filter((album): album is AlbumSummary & { name: string } => !!album.name)
      .map((album) => ({
        name: album.name,
        artist: artistDisplayName(album.artist),
        artistSegment: album.artist_slug ?? artistRouteSegment(album.artist),
        artworkFsNodeId: album.artwork_media_id,
      })),
    term,
    (album) => album.name,
  );

const entryFromArtist = (artist: Artist): SearchArtistEntry => ({
  name: artist.name,
  segment: artist.slug || artist.name,
  artist,
});

/**
 * The Artists section list (FR-33): direct /artists hits FIRST so their
 * slugs survive, then unique names harvested from matched songs and
 * albums, deduped case-insensitively, then re-ranked as one list.
 */
export const deriveArtistEntries = (
  directArtists: Artist[],
  songs: Song[],
  albums: SearchAlbumHit[],
  term: string,
): SearchArtistEntry[] => {
  const seen = new Set<string>();
  const out: SearchArtistEntry[] = [];

  const push = (entry: SearchArtistEntry | null): void => {
    if (!entry || !entry.name) return;
    const key = entry.name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(entry);
  };

  for (const artist of directArtists) push(entryFromArtist(artist));

  for (const song of songs) {
    const primaries = primaryArtists(song);
    if (primaries.length > 0) {
      for (const primary of primaries) {
        push({
          name: primary.name,
          segment: primary.slug || primary.name,
        });
      }
      continue;
    }
    for (const name of artistNamesList(song.artist_names)) {
      push({ name, segment: name });
    }
  }

  for (const album of albums) {
    if (!album.artist) continue;
    push({
      name: album.artist,
      segment: album.artistSegment ?? album.artist,
    });
  }

  return rankByMatch(out, term, (entry) => entry.name);
};

export interface SearchLists {
  songs: Song[];
  /** Direct /artists resource hits, already ranked. */
  directArtists: Artist[];
  /** Direct hits merged with derived names, already ranked. */
  artists: SearchArtistEntry[];
  albums: SearchAlbumHit[];
  playlists: Playlist[];
}

/**
 * Top-result priority (FR-33): with a kind filter active the first item of
 * that kind wins; otherwise a DIRECT artist hit beats everything (the user
 * typed an artist), then song > album > playlist, and a derived artist is
 * the last resort.
 */
export const pickTopResult = (
  filter: SearchFilter,
  lists: SearchLists,
): TopResult | null => {
  const { songs, directArtists, artists, albums, playlists } = lists;

  if (filter === "songs" && songs[0]) return { kind: "song", song: songs[0] };
  if (filter === "artists" && artists[0]) return { kind: "artist", entry: artists[0] };
  if (filter === "albums" && albums[0]) return { kind: "album", album: albums[0] };
  if (filter === "playlists" && playlists[0])
    return { kind: "playlist", playlist: playlists[0] };

  if (directArtists[0]) return { kind: "artist", entry: entryFromArtist(directArtists[0]) };
  if (songs[0]) return { kind: "song", song: songs[0] };
  if (albums[0]) return { kind: "album", album: albums[0] };
  if (playlists[0]) return { kind: "playlist", playlist: playlists[0] };
  if (artists[0]) return { kind: "artist", entry: artists[0] };
  return null;
};

/** Suggestion dropdown: top 3 per kind, in order songs, artists, albums, playlists. */
export const buildSuggestions = (lists: {
  songs: Song[];
  directArtists: Artist[];
  albums: SearchAlbumHit[];
  playlists: Playlist[];
}): SearchSuggestion[] => {
  const out: SearchSuggestion[] = [];
  for (const song of lists.songs.slice(0, MAX_SUGGESTIONS_PER_KIND)) {
    out.push({ kind: "song", song });
  }
  for (const artist of lists.directArtists.slice(0, MAX_SUGGESTIONS_PER_KIND)) {
    out.push({ kind: "artist", entry: entryFromArtist(artist) });
  }
  for (const album of lists.albums.slice(0, MAX_SUGGESTIONS_PER_KIND)) {
    out.push({ kind: "album", album });
  }
  for (const playlist of lists.playlists.slice(0, MAX_SUGGESTIONS_PER_KIND)) {
    out.push({ kind: "playlist", playlist });
  }
  return out;
};

/** Album route for a hit; a missing artist keeps the literal "null". */
export const albumHitRoute = (album: SearchAlbumHit): Href =>
  albumRoute(album.artistSegment, album.name);
