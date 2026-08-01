/** Radio hooks (FR-122). Server caches 7 days per (user, seed). */
import { useQuery } from "@tanstack/react-query";
import { getArtistRadio, getSongRadio } from "../endpoints/radios";
import { keys } from "../queryKeys";
import { guardedQueryFn } from "./common";
import { useAuthReady } from "@/auth/guard";
import type { SongId } from "@/domain/ids";

export const useArtistRadio = (slugOrName: string | null, enabled = true) => {
  const authReady = useAuthReady();
  const key = keys.radios.artist(slugOrName ?? "");
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, () => getArtistRadio(slugOrName as string)),
    enabled: authReady && enabled && !!slugOrName,
    staleTime: 5 * 60 * 1000,
  });
};

export const useSongRadio = (songId: SongId | null, enabled = true) => {
  const authReady = useAuthReady();
  const key = songId != null ? keys.radios.song(songId) : ["radios", "song", "none"];
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, () => getSongRadio(songId as SongId)),
    enabled: authReady && enabled && songId != null,
    staleTime: 5 * 60 * 1000,
  });
};
