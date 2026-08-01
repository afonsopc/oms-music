/** Social hooks: music profile (FR-120). */
import { useQuery } from "@tanstack/react-query";
import { getMusicProfile } from "../endpoints/social";
import { keys } from "../queryKeys";
import { guardedQueryFn } from "./common";
import { useAuthReady } from "@/auth/guard";

export const useMusicProfile = (idOrHandle: string | null, enabled = true) => {
  const authReady = useAuthReady();
  const key = keys.musicProfile(idOrHandle ?? "");
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, () => getMusicProfile(idOrHandle as string)),
    enabled: authReady && enabled && !!idOrHandle,
  });
};
