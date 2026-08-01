/**
 * Offline lyrics read semantics (FR-81, read half). Downloads store lyrics
 * on the dl_songs row with a tri-state (frozen DDL, DESIGN 9.1):
 *
 *   'unfetched' -> never fetched: NO offline answer; repair re-fetches on
 *                  the next reconnect, the resolver must fall through.
 *   'none'      -> confirmed "backend has none": a legitimate all-null
 *                  Lyrics answer, never refetched forever.
 *   'cached'    -> lyrics_json holds the cached Lyrics payload.
 *
 * The lyrics feature itself reads through the contracts resolver: WP1's
 * `useLyrics` query fn is wrapped with `withOfflineFallback(..., "lyrics")`
 * and WP8 registers the resolver that reads the dl_songs row. This module
 * owns the row -> Lyrics interpretation so the read semantics live with the
 * lyrics package and stay bun-testable.
 */
import type { LyricsState } from "@/domain/downloads";
import type { Lyrics } from "@/domain/lyrics";

/** Projection of the dl_songs columns the read path needs. */
export interface OfflineLyricsRow {
  lyrics_state: LyricsState;
  lyrics_json: string | null;
}

/** The confirmed-absent answer: same shape the backend 200s with. */
export const NO_LYRICS: Lyrics = { synced: null, plain: null, attribution: null };

/**
 * Maps a dl_songs row projection to the offline lyrics answer. `null` means
 * "no offline answer" (song not downloaded, lyrics unfetched, or corrupt
 * cache): the resolver falls through so the query surfaces the normal
 * offline error state instead of a fake "no lyrics" empty state.
 */
export const offlineLyricsFromRow = (
  row: OfflineLyricsRow | null | undefined,
): Lyrics | null => {
  if (!row) return null;
  if (row.lyrics_state === "none") return NO_LYRICS;
  if (row.lyrics_state === "cached" && row.lyrics_json) {
    try {
      const parsed = JSON.parse(row.lyrics_json) as Partial<Lyrics> | null;
      if (!parsed || typeof parsed !== "object") return null;
      return {
        synced: typeof parsed.synced === "string" ? parsed.synced : null,
        plain: typeof parsed.plain === "string" ? parsed.plain : null,
        attribution: typeof parsed.attribution === "string" ? parsed.attribution : null,
      };
    } catch {
      return null;
    }
  }
  return null;
};
