/** Social hooks: music profiles (FR-120). Presigned media in the payload is
 *  used AS-IS; never resolve another user's media. `{ visible: false }` is a
 *  200 for strangers/private accounts. */
import { useQuery } from "@tanstack/react-query";
import { oms } from "../oms";
import { keys } from "../queryKeys";
import { guardedQueryFn } from "./common";
import { useAuthReady } from "@/auth/guard";
import type { MusicProfile } from "@/domain/social";

export const useMusicProfile = (idOrHandle: string | null, enabled = true) => {
  const authReady = useAuthReady();
  const key = keys.musicProfile(idOrHandle ?? "");
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(
      key,
      () => oms().music.social.profiles.get(idOrHandle as string) as Promise<MusicProfile>,
    ),
    enabled: authReady && enabled && !!idOrHandle,
  });
};
