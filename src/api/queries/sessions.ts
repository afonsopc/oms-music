/** Session hooks (FR-14 devices screen data). Login/logout live in auth/session.ts. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { collect } from "@omelhorsite/sdk";
import { oms } from "../oms";
import { keys } from "../queryKeys";
import { FULL_PAGE, WHOLE_LIST_LIMIT, guardedQueryFn } from "./common";
import { useAuthReady } from "@/auth/guard";
import type { Session } from "@/domain/user";

/** Every session of the account (a handful; one page in practice). */
export const listSessions = async (): Promise<Session[]> =>
  (await collect(
    await oms().account.sessions.list({ pageSize: FULL_PAGE }),
    WHOLE_LIST_LIMIT,
  )) as Session[];

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
      oms().account.sessions.update(id, { name }) as Promise<Session>,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.sessions });
    },
  });
};
