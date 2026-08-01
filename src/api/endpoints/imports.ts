/**
 * External search + song/playlist imports REST (API.md section 11).
 * external_search rate limit returns 400 "Rate limit exceeded" (not 429).
 * Deduped song imports come back already terminal - never poll them.
 */
import { request } from "../client";
import type { ListFilters } from "@/domain/api";
import type { PlaylistId } from "@/domain/ids";
import type {
  ArtworkSearchItem,
  DownloaderPreview,
  ExternalSearchResponse,
  SongImport,
} from "@/domain/imports";

export const externalSearch = (
  q: string,
  kind: "track" | "album" | "artist" | "any" = "track",
): Promise<ExternalSearchResponse> =>
  request("GET", "/music/external_search", { params: { q, kind }, timeoutMs: 60_000 });

/** URL mode: { source_url } only. Search mode: search_* fields, NO source_url. */
export interface SongImportBody {
  source_url?: string;
  search_artist?: string;
  search_title?: string;
  search_album?: string;
  isrc?: string;
  source_provider?: string;
  source_id?: string;
  source_kind?: string;
  override_title?: string;
  override_artist?: string;
  override_album?: string;
  artwork_url?: string;
  artwork_data_b64?: string;
  expected_duration_s?: number;
  playlist_id?: PlaylistId;
  position?: number;
}

export const createSongImport = (body: SongImportBody): Promise<SongImport> =>
  request("POST", "/song_imports", { body, timeoutMs: 120_000 });

export const getSongImport = (id: number): Promise<SongImport> =>
  request("GET", `/song_imports/${id}`);

export const listSongImports = (filters: ListFilters = {}): Promise<SongImport[]> =>
  request("GET", "/song_imports", { params: filters });

/** 60/h cap; Spotify URLs and SSRF-suspect URLs refuse with 400 text. */
export const previewPlaylistImport = (url: string): Promise<DownloaderPreview> =>
  request("POST", "/playlist_imports/preview", { body: { url }, timeoutMs: 120_000 });

export const searchArtwork = (query: {
  artist?: string;
  title?: string;
  album?: string;
  query?: string;
}): Promise<{ items: ArtworkSearchItem[] }> =>
  request("POST", "/tools_downloader/artwork_search", { body: query, timeoutMs: 60_000 });
