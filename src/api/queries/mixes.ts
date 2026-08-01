/** Mix hooks (FR-25, FR-121). Server caches 24h/user - no fake refresh UX. */
import { useQuery } from "@tanstack/react-query";
import { getMix, listMixes } from "../endpoints/mixes";
import { keys } from "../queryKeys";
import { guardedQueryFn } from "./common";
import { useAuthReady } from "@/auth/guard";

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
