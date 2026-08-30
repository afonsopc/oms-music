/** Jam hooks. GET /jams on app start resumes an in-progress jam (FR-113). */
import { useQuery } from "@tanstack/react-query";
import { oms } from "../oms";
import { keys } from "../queryKeys";
import { guardedQueryFn } from "./common";
import { useAuthReady } from "@/auth/guard";
import type { JamsIndex } from "@/domain/jam";

export const getJams = (): Promise<JamsIndex> =>
  oms().music.social.jams.list() as Promise<JamsIndex>;

export const useJams = (enabled = true) => {
  const authReady = useAuthReady();
  const key = keys.jams;
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, () => getJams()),
    enabled: authReady && enabled,
  });
};
