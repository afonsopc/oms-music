import type { Song, SongArtistEntry } from "./song";

type ArtistsCarrier = { artists?: SongArtistEntry[]; artist_names?: string[] };

const formatArtistsLine = (song: ArtistsCarrier, includeWith: boolean): string => {
  const list = song.artists ?? [];
  if (list.length === 0) return (song.artist_names ?? []).join(", ");
  const sorted = [...list].sort((a, b) => a.position - b.position);
  const primary = sorted.filter((a) => a.role === "primary");
  const featured = sorted.filter((a) => a.role === "featured");
  const withs = sorted.filter((a) => a.role === "with");
  const head = (primary.length > 0 ? primary : sorted).map((a) => a.name).join(", ");
  const parts: string[] = [head];
  if (featured.length > 0) parts.push(`(feat. ${featured.map((a) => a.name).join(", ")})`);
  if (includeWith && withs.length > 0) parts.push(`(with ${withs.map((a) => a.name).join(", ")})`);
  return parts.join(" ");
};

/** "A, B (feat. C)". Only primary + featured inline; "with" lives in credits. */
export const formatArtists = (song: ArtistsCarrier): string => formatArtistsLine(song, false);

/** Full variant keeping "(with ...)"; for lock-screen metadata and credits. */
export const formatArtistsFull = (song: ArtistsCarrier): string => formatArtistsLine(song, true);

export const primaryArtists = (song: { artists?: SongArtistEntry[] }): SongArtistEntry[] =>
  (song.artists ?? []).filter((a) => a.role === "primary").sort((a, b) => a.position - b.position);

export const featuredArtists = (song: { artists?: SongArtistEntry[] }): SongArtistEntry[] =>
  (song.artists ?? []).filter((a) => a.role === "featured").sort((a, b) => a.position - b.position);

export const withArtists = (song: { artists?: SongArtistEntry[] }): SongArtistEntry[] =>
  (song.artists ?? []).filter((a) => a.role === "with").sort((a, b) => a.position - b.position);

/**
 * Slug of the first primary artist, for artist routes. Falls back to the
 * URL-encoded name; "null" when nothing resolves (the unknown-artist segment).
 */
export const primaryArtistSlug = (song: ArtistsCarrier): string => {
  const list = song.artists ?? [];
  const primary = list.find((a) => a.role === "primary") ?? list[0];
  if (primary?.slug) return primary.slug;
  if (primary?.name) return encodeURIComponent(primary.name);
  const legacy = song.artist_names?.[0];
  if (legacy) return encodeURIComponent(legacy);
  return "null";
};

/** Seconds -> "m:ss" (durations in tables and scrub labels). */
export const formatDuration = (seconds: number): string => {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
};

/** Seconds -> "h h m min" style total. Returns { hours, minutes, seconds }. */
export const splitDuration = (
  seconds: number,
): { hours: number; minutes: number; seconds: number } => {
  const total = Math.max(0, Math.floor(seconds));
  return {
    hours: Math.floor(total / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
};

export const totalDuration = (songs: readonly Pick<Song, "duration">[]): number =>
  songs.reduce((sum, s) => sum + (s.duration || 0), 0);
