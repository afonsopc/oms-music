/**
 * POST /song_imports input for an external search hit (FR-34), pure so the
 * two request shapes are unit-testable. The SDK's `CreateSongImportInput`
 * (camelCase) is what `createSongImport` takes; the SDK writes the snake_case
 * wire body.
 *
 *  - URL mode (youtube / soundcloud): `{ sourceUrl }`, NO search* keys;
 *  - search mode (spotify / itunes / bandcamp): `{ searchArtist,
 *    searchTitle, searchAlbum?, isrc? }` and NO sourceUrl.
 *
 * Both carry the common source/override/artwork metadata. Keys we have no
 * value for are OMITTED, never sent as null: the SDK drops undefined and
 * keeps null, and a null would reach the server as an explicit empty value.
 */
import type { CreateSongImportInput } from "@omelhorsite/sdk";
import type { ExternalSearchResult } from "@/domain/imports";

const URL_MODE_SOURCES = new Set(["youtube", "soundcloud"]);

export const buildImportBody = (track: ExternalSearchResult): CreateSongImportInput => {
  // A URL-mode source with no usable URL still imports: fall back to the
  // server-side search cascade rather than posting an empty body.
  const urlMode = URL_MODE_SOURCES.has(track.source) && !!track.source_url;
  const base: CreateSongImportInput = urlMode
    ? { sourceUrl: track.source_url as string }
    : {
        searchArtist: track.artist,
        searchTitle: track.title,
        ...(track.album ? { searchAlbum: track.album } : {}),
        ...(track.isrc ? { isrc: track.isrc } : {}),
      };
  return {
    ...base,
    sourceProvider: track.source,
    sourceId: track.source_id,
    overrideTitle: track.title,
    overrideArtist: track.artist,
    ...(track.album ? { overrideAlbum: track.album } : {}),
    ...(track.artwork_url ? { artworkUrl: track.artwork_url } : {}),
    ...(track.duration_ms
      ? { expectedDurationS: Math.round(track.duration_ms / 1000) }
      : {}),
  };
};
