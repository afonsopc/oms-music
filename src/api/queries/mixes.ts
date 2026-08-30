/**
 * Mix hooks (FR-25, FR-121). Server caches 24h/user - no fake refresh UX.
 * Slugs contain ":" (the SDK URL-encodes them). 404 on a rotated slug means
 * refetch the list.
 *
 * O SDK tipa `songs` como `MusicSongPayload[]`, mas o servidor serializa cada
 * música com o SongBlueprint inteiro (lacuna do SDK): cast para o domínio.
 */
import { useQuery } from "@tanstack/react-query";
import { oms } from "../oms";
import { keys } from "../queryKeys";
import { guardedQueryFn } from "./common";
import { useAuthReady } from "@/auth/guard";
import type { Mix, MixSummary } from "@/domain/mixes";

export const listMixes = (): Promise<MixSummary[]> =>
  oms().music.playlists.mixes.list() as Promise<MixSummary[]>;

export const getMix = (slug: string): Promise<Mix> =>
  oms().music.playlists.mixes.get(slug) as Promise<Mix>;

export const useMixes = (enabled = true) => {
  const authReady = useAuthReady();
  const key = keys.mixes.list;
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, () => listMixes()),
    enabled: authReady && enabled,
    staleTime: 10 * 60 * 1000,
  });
};

/** 404 on a rotated slug: the screen refetches the list and goes home. */
export const useMix = (slug: string | null, enabled = true) => {
  const authReady = useAuthReady();
  const key = keys.mixes.detail(slug ?? "");
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, () => getMix(slug as string)),
    enabled: authReady && enabled && !!slug,
    staleTime: 10 * 60 * 1000,
  });
};
