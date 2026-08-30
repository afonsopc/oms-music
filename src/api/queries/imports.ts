/**
 * Import hooks (FR-34, FR-101/102). Deduped responses are already terminal -
 * the poll interval function stops on them. Callers invalidate the library
 * lists (keys in invalidationTargets.libraryLists) on completion.
 * external_search rate limit returns 400 "Rate limit exceeded" (not 429).
 *
 * Os inputs são os do SDK (`CreateSongImportInput`, camelCase); o SDK escreve
 * o corpo snake_case. Os tipos de resposta ficam os do domínio: o
 * `MusicExternalTrack` do SDK anula `title`/`artist`/`source_id`, que o
 * servidor preenche sempre para os hits que a app mostra (cast de fronteira).
 */
import { useQuery } from "@tanstack/react-query";
import type {
  ArtworkSearchInput,
  CreateSongImportInput,
  MusicExternalSearchKind,
} from "@omelhorsite/sdk";
import { oms } from "../oms";
import { keys } from "../queryKeys";
import { guardedQueryFn } from "./common";
import { useAuthReady } from "@/auth/guard";
import type {
  ArtworkSearchItem,
  DownloaderPreview,
  ExternalSearchResponse,
  SongImport,
} from "@/domain/imports";

export const IMPORT_POLL_MS = 1_500;

export const externalSearch = (
  q: string,
  kind: MusicExternalSearchKind = "track",
): Promise<ExternalSearchResponse> =>
  oms().music.songs.externalSearch({ q, kind }, { timeoutMs: 60_000 }) as Promise<ExternalSearchResponse>;

/** URL mode: `sourceUrl` only. Search mode: `searchArtist` + `searchTitle`, NO url. */
export const createSongImport = (input: CreateSongImportInput): Promise<SongImport> =>
  oms().music.imports.create(input, { timeoutMs: 120_000 }) as Promise<SongImport>;

export const getSongImport = (id: number): Promise<SongImport> =>
  oms().music.imports.get(id) as Promise<SongImport>;

/** 60/h cap; Spotify URLs and SSRF-suspect URLs refuse with 400 text. */
export const previewPlaylistImport = (url: string): Promise<DownloaderPreview> =>
  oms().music.imports.previewPlaylist(url) as Promise<DownloaderPreview>;

export const searchArtwork = (query: ArtworkSearchInput): Promise<ArtworkSearchItem[]> =>
  oms().tools.downloader.artworkSearch(query, { timeoutMs: 60_000 }) as Promise<ArtworkSearchItem[]>;

export const useExternalSearch = (
  q: string,
  kind: MusicExternalSearchKind = "track",
  enabled = true,
) => {
  const authReady = useAuthReady();
  const trimmed = q.trim();
  const key = keys.externalSearch(trimmed, kind);
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, () => externalSearch(trimmed, kind)),
    enabled: authReady && enabled && trimmed.length >= 2,
    staleTime: 5 * 60 * 1000, // server caches 15 min
  });
};

const isImportActive = (record: SongImport | undefined): boolean =>
  !!record &&
  !record.deduped &&
  (record.state === "pending" || record.state === "processing");

/** Polls a song import at 1.5s while pending/processing (FR-102). */
export const useSongImportPoll = (id: number | null, enabled = true) => {
  const authReady = useAuthReady();
  const key = id != null ? keys.songImport(id) : ["songImports", "detail", "none"];
  return useQuery<SongImport>({
    queryKey: key,
    queryFn: guardedQueryFn(key, () => getSongImport(id as number)),
    enabled: authReady && enabled && id != null,
    refetchInterval: (query) => (isImportActive(query.state.data) ? IMPORT_POLL_MS : false),
  });
};
