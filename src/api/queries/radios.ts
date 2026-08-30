/**
 * Radio hooks (FR-122). Server caches 7 days per (user, seed); 404 when
 * unbuildable (not an empty list). Titles are pre-baked Portuguese. A cold
 * radio can take a while to build: 60s per attempt, as before.
 *
 * `songs` chega como SongBlueprint inteiro (o SDK tipa-o mais estreito).
 */
import { useQuery } from "@tanstack/react-query";
import { oms } from "../oms";
import { keys } from "../queryKeys";
import { guardedQueryFn } from "./common";
import { useAuthReady } from "@/auth/guard";
import type { SongId } from "@/domain/ids";
import type { Radio } from "@/domain/mixes";

const RADIO_TIMEOUT_MS = 60_000;

export const useArtistRadio = (slugOrName: string | null, enabled = true) => {
  const authReady = useAuthReady();
  const key = keys.radios.artist(slugOrName ?? "");
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(
      key,
      () =>
        oms().music.playlists.radios.forArtist(slugOrName as string, {
          timeoutMs: RADIO_TIMEOUT_MS,
        }) as Promise<Radio>,
    ),
    enabled: authReady && enabled && !!slugOrName,
    staleTime: 5 * 60 * 1000,
  });
};

export const useSongRadio = (songId: SongId | null, enabled = true) => {
  const authReady = useAuthReady();
  const key = songId != null ? keys.radios.song(songId) : ["radios", "song", "none"];
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(
      key,
      () =>
        oms().music.playlists.radios.forSong(songId as SongId, {
          timeoutMs: RADIO_TIMEOUT_MS,
        }) as Promise<Radio>,
    ),
    enabled: authReady && enabled && songId != null,
    staleTime: 5 * 60 * 1000,
  });
};
