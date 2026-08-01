/**
 * The complete react-query key namespace (frozen contract). Invalidation
 * targets are part of the contract:
 *  - imports invalidate songs/albums/artists/playlists,
 *  - like toggles patch `likedIds` (and invalidate the liked list),
 *  - playlist mutations invalidate `playlists` + the touched `playlistSongs`.
 */
import type { QueryKey } from "@tanstack/react-query";
import type { ArtistId, PlaylistId, SongId } from "@/domain/ids";

export const keys = {
  session: {
    mine: ["session", "mine"] as QueryKey,
  },
  user: (id: string): QueryKey => ["user", id],
  musicProfile: (idOrHandle: string): QueryKey => ["musicProfile", idOrHandle],
  relationships: ["relationships"] as QueryKey,
  identities: ["identities"] as QueryKey,

  songs: {
    all: ["songs"] as QueryKey,
    list: (filters: unknown): QueryKey => ["songs", "list", filters],
    infinite: (filters: unknown): QueryKey => ["songs", "infinite", filters],
    detail: (id: SongId): QueryKey => ["songs", "detail", id],
    byAlbum: (album: string | null, artist?: string | null): QueryKey => [
      "songs",
      "byAlbum",
      album,
      artist ?? null,
    ],
    byArtist: (artist: string, role: string): QueryKey => ["songs", "byArtist", artist, role],
    separation: (id: SongId): QueryKey => ["songs", "separation", id],
    artistPictures: (name: string): QueryKey => ["songs", "artistPictures", name],
  },
  albums: {
    all: ["albums"] as QueryKey,
    list: (filters: unknown): QueryKey => ["albums", "list", filters],
    random: (count: number): QueryKey => ["albums", "random", count],
  },
  artists: {
    all: ["artists"] as QueryKey,
    list: (filters: unknown): QueryKey => ["artists", "list", filters],
    infinite: (order: string, search: string | null): QueryKey => [
      "artists",
      "infinite",
      order,
      search,
    ],
    detail: (idOrSlug: string): QueryKey => ["artists", "detail", idOrSlug],
    overview: ["artists", "overview"] as QueryKey,
    metadata: (name: string): QueryKey => ["artists", "metadata", name],
  },
  playlists: {
    all: ["playlists"] as QueryKey,
    list: (filters: unknown): QueryKey => ["playlists", "list", filters],
    detail: (id: PlaylistId): QueryKey => ["playlists", "detail", id],
  },
  playlistSongs: (playlistId: PlaylistId): QueryKey => ["playlistSongs", playlistId],
  songMembership: (songId: SongId): QueryKey => ["playlistSongs", "membership", songId],

  liked: {
    list: ["liked", "list"] as QueryKey,
    ids: ["liked", "ids"] as QueryKey,
  },
  /** Back-compat alias named in DESIGN 5: keys.likedIds. */
  likedIds: ["liked", "ids"] as QueryKey,

  playEvents: {
    recentAlbums: (limit: number): QueryKey => ["playEvents", "recentAlbums", limit],
    top: (scope: string, since: string, artist: string | null, limit: number): QueryKey => [
      "playEvents",
      "top",
      scope,
      since,
      artist,
      limit,
    ],
  },

  lyrics: (songId: SongId): QueryKey => ["lyrics", songId],
  lyricsTranslation: (songId: SongId, target: string): QueryKey => [
    "lyrics",
    "translation",
    songId,
    target,
  ],
  job: (id: string): QueryKey => ["job", id],

  mixes: {
    list: ["mixes", "list"] as QueryKey,
    detail: (slug: string): QueryKey => ["mixes", "detail", slug],
  },
  radios: {
    artist: (slugOrName: string): QueryKey => ["radios", "artist", slugOrName],
    song: (id: SongId): QueryKey => ["radios", "song", id],
  },

  jams: ["jams"] as QueryKey,

  externalSearch: (q: string, kind: string): QueryKey => ["externalSearch", q, kind],
  songImport: (id: number): QueryKey => ["songImports", "detail", id],
  songImports: (filters: unknown): QueryKey => ["songImports", "list", filters],
  artworkSearch: (query: unknown): QueryKey => ["artworkSearch", query],

  spotifySync: {
    status: ["spotifySync", "status"] as QueryKey,
    preview: ["spotifySync", "preview"] as QueryKey,
  },
  artistImports: {
    search: (q: string): QueryKey => ["artistImports", "search", q],
    albums: (spotifyArtistId: string): QueryKey => ["artistImports", "albums", spotifyArtistId],
    recents: ["artistImports", "recents"] as QueryKey,
  },

  sessions: ["sessions"] as QueryKey,
  serviceUsagesTop: (limit: number): QueryKey => ["serviceUsages", "top", limit],
} as const;

/** Invalidation helper groups (the frozen targets). */
export const invalidationTargets = {
  /** After any import completes. */
  libraryLists: [
    ["songs"],
    ["albums"],
    ["artists"],
    ["playlists"],
  ] as QueryKey[],
  /** After any artist rename/image change. */
  artistSurfaces: [["artists"], ["songs"]] as QueryKey[],
};

/** Keys of the ArtistId type are numeric; helper for detail lookups by id. */
export const artistDetailKeyById = (id: ArtistId): QueryKey => keys.artists.detail(String(id));
