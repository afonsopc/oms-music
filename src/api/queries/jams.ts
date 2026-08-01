/** Jam hooks. GET /jams on app start resumes an in-progress jam (FR-113). */
import { useQuery } from "@tanstack/react-query";
import { getJams } from "../endpoints/jams";
import { keys } from "../queryKeys";
import { guardedQueryFn } from "./common";
import { useAuthReady } from "@/auth/guard";

export const useJams = (enabled = true) => {
  const authReady = useAuthReady();
  const key = keys.jams;
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, () => getJams()),
    enabled: authReady && enabled,
  });
};
