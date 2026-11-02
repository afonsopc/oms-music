/** Session hooks (FR-14 devices screen data). Login/logout live in auth/session.ts. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { oms } from "../oms";
import { keys } from "../queryKeys";
import { guardedQueryFn } from "./common";
import { useAuthReady } from "@/auth/guard";
import type { Session } from "@/domain/user";

/** As sessões da música da conta (GET /music/sessions, uma lista curta). */
export const listSessions = (): Promise<Session[]> => oms().http.get<Session[]>("/music/sessions");

export const useSessions = (enabled = true) => {
  const authReady = useAuthReady();
  const key = keys.sessions;
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, () => listSessions()),
    enabled: authReady && enabled,
  });
};

/** Rename the CURRENT session (name 1..50); there is NO revoke-other (server
 *  kills the caller on any DELETE) - never render that affordance. */
export const useRenameSession = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      oms().http.patch<Session>(`/music/sessions/${encodeURIComponent(id)}`, { name }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.sessions });
    },
  });
};
