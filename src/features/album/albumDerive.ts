/**
 * Album screen derivations (FR-43), pure so they can be unit-tested.
 *
 * The album listing is deliberately NOT filtered by artist server-side (an
 * album opened from a featured artist's page must still show every track),
 * so the narrowing happens here - and falls back to ALL matches when the
 * context artist contributes nothing, which is what keeps legacy name URLs
 * working.
 *
 * Note: `SongArtistEntry.id` is the song_artists JOIN-ROW id; the artist is
 * `artist_id`. Matching on `id` (as the web does) compares a join-row id to
 * an artist id and narrows by accident.
 */
import type { ArtistId } from "@/domain/ids";
import type { Song, SongArtistEntry } from "@/domain/song";

export interface AlbumPrimaryArtist {
  artistId: number;
  name: string;
  slug: string;
}

const primaryEntries = (song: Song): SongArtistEntry[] =>
  (song.artists ?? []).filter((a) => a.role === "primary");

/**
 * Songs credited to the context artist in ANY role; when none are, every
 * match is kept (no context artist resolved, or the album simply is not
 * theirs).
 */
export const narrowToContextArtist = (
  songs: readonly Song[],
  contextArtistId: ArtistId | null | undefined,
): Song[] => {
  const all = [...songs];
  if (contextArtistId == null) return all;
  const matching = all.filter((song) =>
    (song.artists ?? []).some((a) => a.artist_id === contextArtistId),
  );
  return matching.length > 0 ? matching : all;
};

/**
 * The album's ACTUAL primary artist by majority vote across its tracks -
 * used for the header link, which may differ from the context artist (which
 * might merely be featured on the album). Ties keep the first seen.
 */
export const majorityPrimaryArtist = (songs: readonly Song[]): AlbumPrimaryArtist | null => {
  const counts = new Map<number, { entry: SongArtistEntry; count: number }>();
  for (const song of songs) {
    for (const entry of primaryEntries(song)) {
      const existing = counts.get(entry.artist_id);
      if (existing) {
        existing.count += 1;
      } else {
        counts.set(entry.artist_id, { entry, count: 1 });
      }
    }
  }
  let best: { entry: SongArtistEntry; count: number } | null = null;
  for (const candidate of counts.values()) {
    if (!best || candidate.count > best.count) best = candidate;
  }
  if (!best) return null;
  return {
    artistId: best.entry.artist_id,
    name: best.entry.name,
    slug: best.entry.slug,
  };
};

/** First year present across the tracks (albums rarely disagree). */
export const albumYear = (songs: readonly Song[]): number | null =>
  songs.find((song) => song.year != null)?.year ?? null;

/** "M min Ss" total, matching the web album meta row. */
export const formatAlbumDuration = (totalSeconds: number): string => {
  const total = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(total / 60)} min ${total % 60}s`;
};
