/** Hooks do sync diário por artista (3.5). */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { searchArtistImports } from "../endpoints/artistImports";
import {
  createArtistSync,
  deleteArtistSync,
  listArtistSyncs,
  type ArtistSyncRow,
} from "../endpoints/artistSyncs";
import { guardedQueryFn } from "./common";
import { useAuthReady } from "@/auth/guard";

const KEY = ["artistSyncs"] as const;

export const useArtistSyncs = (enabled = true) => {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: KEY,
    queryFn: guardedQueryFn(KEY, () => listArtistSyncs()),
    enabled: authReady && enabled,
  });
};

/** A row deste artista, casada por nome (o cliente não guarda spotify ids). */
export const findArtistSync = (
  items: readonly ArtistSyncRow[] | undefined,
  artistName: string,
): ArtistSyncRow | null => {
  const needle = artistName.trim().toLowerCase();
  if (!needle) return null;
  return items?.find((row) => (row.artist_name ?? "").trim().toLowerCase() === needle) ?? null;
};

/**
 * Liga o sync: resolve o spotify_artist_id pela pesquisa de imports (o
 * primeiro hit Spotify cujo nome bata, senão o primeiro de todos - é o
 * ranking do próprio Spotify) e cria a row. O servidor tira o snapshot.
 */
export const useEnableArtistSync = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (artistName: string) => {
      const results = await searchArtistImports(artistName);
      const needle = artistName.trim().toLowerCase();
      const hit =
        results.spotify.find((row) => row.name.trim().toLowerCase() === needle) ??
        results.spotify[0];
      if (!hit) throw new Error("artist not on spotify");
      return createArtistSync({ spotify_artist_id: hit.id, spotify_artist_name: artistName });
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: KEY }),
  });
};

export const useDisableArtistSync = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteArtistSync(id),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: KEY }),
  });
};
