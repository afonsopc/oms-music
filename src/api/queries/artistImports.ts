/**
 * Artist import hooks (FR-104). Requires a linked Spotify IDENTITY (400
 * "Connect Spotify first." / relink message), NOT the allowlist flag.
 * Recents poll 1.5s while queued/running.
 */
import { useQuery } from "@tanstack/react-query";
import type { ArtistImport, ArtistImportSearchResult, CreateArtistImportInput } from "@omelhorsite/sdk";
import { oms } from "../oms";
import { keys } from "../queryKeys";
import { guardedQueryFn } from "./common";
import { useAuthReady } from "@/auth/guard";

const POLL_MS = 1_500;

export const searchArtistImports = (q: string): Promise<ArtistImportSearchResult> =>
  oms().music.artists.imports.search(q);

export const createArtistImport = (input: CreateArtistImportInput): Promise<ArtistImport> =>
  oms().music.artists.imports.create(input);

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
    queryFn: guardedQueryFn(key, () =>
      oms().music.artists.imports.albums(spotifyArtistId as string),
    ),
    enabled: authReady && enabled && !!spotifyArtistId,
  });
};

const anyActive = (data: ArtistImport[] | undefined): boolean =>
  !!data?.some((r) => r.state === "queued" || r.state === "running");

/** Newest first, max 50 server-side. */
export const useArtistImportsRecents = (limit = 20, enabled = true) => {
  const authReady = useAuthReady();
  const key = keys.artistImports.recents;
  return useQuery<ArtistImport[]>({
    queryKey: key,
    queryFn: guardedQueryFn(key, () => oms().music.artists.imports.list({ limit })),
    enabled: authReady && enabled,
    refetchInterval: (query) => (anyActive(query.state.data) ? POLL_MS : false),
  });
};
