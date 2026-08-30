/**
 * URL import (FR-101), pure half: turning a `POST /playlist_imports/preview`
 * answer into editable tracks and each track into its `POST /song_imports`
 * body. Ported from the web PlaylistImportModal.
 *
 * Rules kept verbatim:
 *  - tracks without a `webpage_url` are DROPPED (nothing to download);
 *  - `source_provider` is the extractor up to the first ":" ("youtube:tab"
 *    -> "youtube");
 *  - `position` increments from 1 and is only sent with a playlist target;
 *  - artwork travels as `artwork_url` (remote) or `artwork_data_b64`
 *    (uploaded bytes), never both;
 *  - empty override fields are omitted, not sent blank.
 */
import type { CreateSongImportInput } from "@omelhorsite/sdk";
import type { PlaylistId } from "@/domain/ids";
import type { DownloaderPreview } from "@/domain/imports";

export type ArtworkSelection =
  | { kind: "url"; url: string }
  | { kind: "data"; base64: string; previewUri?: string };

export interface ImportableTrack {
  /** Stable key: the webpage URL (unique per preview). */
  key: string;
  webpageUrl: string;
  title: string;
  artist: string;
  album: string;
  durationS?: number;
  extractor?: string;
  sourceId?: string;
  /** Preview thumbnail (largest), the default artwork. */
  thumbnailUrl?: string;
  artwork: ArtworkSelection | null;
}

const largestThumbnail = (
  thumbnails: { url: string }[] | undefined,
): string | undefined => (thumbnails && thumbnails.length > 0 ? thumbnails[thumbnails.length - 1]?.url : undefined);

/** Extractor before the first ":" ("youtube:tab" -> "youtube"). */
export const providerFromExtractor = (extractor: string | undefined): string | undefined => {
  if (!extractor) return undefined;
  const head = extractor.split(":")[0];
  return head && head.length > 0 ? head : undefined;
};

export const tracksFromPreview = (preview: DownloaderPreview): ImportableTrack[] => {
  if (preview.kind === "track") {
    if (!preview.webpage_url) return [];
    return [
      {
        key: preview.webpage_url,
        webpageUrl: preview.webpage_url,
        title: preview.title ?? "",
        artist: preview.artist ?? "",
        album: preview.album ?? "",
        durationS: preview.duration_s,
        extractor: preview.extractor,
        sourceId: preview.id,
        thumbnailUrl: largestThumbnail(preview.thumbnails),
        artwork: null,
      },
    ];
  }
  return preview.tracks
    .filter((track) => !!track.webpage_url)
    .map((track) => ({
      key: track.webpage_url as string,
      webpageUrl: track.webpage_url as string,
      title: track.title ?? "",
      artist: track.artist ?? "",
      album: track.album ?? "",
      durationS: track.duration_s,
      extractor: undefined,
      sourceId: track.id,
      thumbnailUrl: undefined,
      artwork: null,
    }));
};

export const previewTitle = (preview: DownloaderPreview): string | undefined => preview.title;

export const previewTrackCount = (preview: DownloaderPreview): number =>
  preview.kind === "playlist" ? preview.count : 1;

export const songImportBody = (
  track: ImportableTrack,
  playlistId: PlaylistId | null,
  position: number,
): CreateSongImportInput => {
  const provider = providerFromExtractor(track.extractor);
  // Mutable while assembled; the SDK input is readonly.
  const body: { -readonly [K in keyof CreateSongImportInput]: CreateSongImportInput[K] } = {
    sourceUrl: track.webpageUrl,
    sourceKind: "yt_dlp",
  };
  if (provider) body.sourceProvider = provider;
  if (track.sourceId) body.sourceId = track.sourceId;
  if (playlistId != null) {
    body.playlistId = playlistId;
    body.position = position;
  }
  if (track.title.trim()) body.overrideTitle = track.title.trim();
  if (track.artist.trim()) body.overrideArtist = track.artist.trim();
  if (track.album.trim()) body.overrideAlbum = track.album.trim();
  if (track.artwork?.kind === "url") body.artworkUrl = track.artwork.url;
  if (track.artwork?.kind === "data") body.artworkDataB64 = track.artwork.base64;
  else if (!track.artwork && track.thumbnailUrl) body.artworkUrl = track.thumbnailUrl;
  if (track.durationS != null) body.expectedDurationS = track.durationS;
  return body;
};

/** Percent for a progress row; `progress_pct` is a FLOAT 0..1 on the wire. */
export const importPercent = (progressPct: number | null | undefined): number =>
  Math.max(0, Math.min(100, Math.round((progressPct ?? 0) * 100)));

/** Deduped creates come back already terminal - never poll them (FR-102). */
export const isImportTerminal = (record: {
  state: string;
  deduped: boolean;
}): boolean => record.deduped || record.state === "complete" || record.state === "failed";
