/**
 * Import hooks (FR-34, FR-101/102). Deduped responses are already terminal -
 * the poll interval function stops on them. Callers invalidate the library
 * lists (keys in invalidationTargets.libraryLists) on completion.
 */
import { useQuery } from "@tanstack/react-query";
import { externalSearch, getSongImport } from "../endpoints/imports";
import { keys } from "../queryKeys";
import { guardedQueryFn } from "./common";
import { useAuthReady } from "@/auth/guard";
import type { SongImport } from "@/domain/imports";

export const IMPORT_POLL_MS = 1_500;

export const useExternalSearch = (
  q: string,
  kind: "track" | "album" | "artist" | "any" = "track",
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
