/**
 * POST /song_imports body for an external search hit (FR-34), pure so the
 * two request shapes are unit-testable:
 *
 *  - URL mode (youtube / soundcloud): `{ source_url }`, NO search_* keys;
 *  - search mode (spotify / itunes / bandcamp): `{ search_artist,
 *    search_title, search_album?, isrc? }` and NO source_url.
 *
 * Both carry the common source/override/artwork metadata. Keys we have no
 * value for are OMITTED, never sent as null: a null would be rewritten to
 * the "\b" sentinel by the client and reach the server as an explicit
 * empty value (API.md section 1).
 */
import type { SongImportBody } from "@/api/endpoints/imports";
import type { ExternalSearchResult } from "@/domain/imports";

const URL_MODE_SOURCES = new Set(["youtube", "soundcloud"]);

export const buildImportBody = (track: ExternalSearchResult): SongImportBody => {
  // A URL-mode source with no usable URL still imports: fall back to the
  // server-side search cascade rather than posting an empty body.
  const urlMode = URL_MODE_SOURCES.has(track.source) && !!track.source_url;
  const base: SongImportBody = urlMode
    ? { source_url: track.source_url as string }
    : {
        search_artist: track.artist,
        search_title: track.title,
        ...(track.album ? { search_album: track.album } : {}),
        ...(track.isrc ? { isrc: track.isrc } : {}),
      };
  return {
    ...base,
    source_provider: track.source,
    source_id: track.source_id,
    override_title: track.title,
    override_artist: track.artist,
    ...(track.album ? { override_album: track.album } : {}),
    ...(track.artwork_url ? { artwork_url: track.artwork_url } : {}),
    ...(track.duration_ms
      ? { expected_duration_s: Math.round(track.duration_ms / 1000) }
      : {}),
  };
};
