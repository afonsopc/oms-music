/** Artist import hooks (FR-104). Recents poll 1.5s while queued/running. */
import { useQuery } from "@tanstack/react-query";
import {
  listArtistImportAlbums,
  listArtistImports,
  searchArtistImports,
} from "../endpoints/artistImports";
import { keys } from "../queryKeys";
import { guardedQueryFn } from "./common";
import { useAuthReady } from "@/auth/guard";
import type { ArtistImport } from "@/domain/imports";

const POLL_MS = 1_500;

export const useArtistImportSearch = (q: string, enabled = true) => {
  const authReady = useAuthReady();
  const trimmed = q.trim();
  const key = keys.artistImports.search(trimmed);
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, () => searchArtistImports(trimmed)),
    enabled: authReady && enabled && trimmed.length >= 2,
  });
};

export const useArtistImportAlbums = (spotifyArtistId: string | null, enabled = true) => {
  const authReady = useAuthReady();
  const key = keys.artistImports.albums(spotifyArtistId ?? "");
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, () => listArtistImportAlbums(spotifyArtistId as string)),
    enabled: authReady && enabled && !!spotifyArtistId,
  });
};

const anyActive = (data: { items: ArtistImport[] } | undefined): boolean =>
  !!data?.items.some((r) => r.state === "queued" || r.state === "running");

export const useArtistImportsRecents = (limit = 20, enabled = true) => {
  const authReady = useAuthReady();
  const key = keys.artistImports.recents;
  return useQuery<{ items: ArtistImport[] }>({
    queryKey: key,
    queryFn: guardedQueryFn(key, () => listArtistImports(limit)),
    enabled: authReady && enabled,
    refetchInterval: (query) => (anyActive(query.state.data) ? POLL_MS : false),
  });
};
