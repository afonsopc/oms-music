/** Session hooks (FR-14 devices screen data). */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listSessions, updateSession } from "../endpoints/sessions";
import { keys } from "../queryKeys";
import { guardedQueryFn } from "./common";
import { useAuthReady } from "@/auth/guard";

export const useSessions = (enabled = true) => {
  const authReady = useAuthReady();
  const key = keys.sessions;
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, () => listSessions()),
    enabled: authReady && enabled,
  });
};

/** Rename the CURRENT session; there is NO revoke-other (server kills the
 *  caller on any DELETE) - never render that affordance. */
export const useRenameSession = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => updateSession(id, { name }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.sessions });
    },
  });
};
