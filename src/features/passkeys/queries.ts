/**
 * Passkey management data (FR-13).
 *
 * The query key is declared here rather than in api/queryKeys.ts because that
 * module states it is the frozen key namespace; nothing outside this feature
 * reads or invalidates passkeys, so a local key keeps the contract intact.
 *
 * The list still goes through `guardedQueryFn`, so it inherits the app's 429
 * parking: a rate-limited fetch is remembered and re-thrown until retry_after
 * elapses instead of turning refetches into a retry storm.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import { guardedQueryFn } from "@/api/queries/common";
import { useAuthReady } from "@/auth/guard";
import { createPasskey, deletePasskey, listPasskeys, type PasskeySummary } from "@/auth/passkeys";

export const passkeysKey: QueryKey = ["passkeys"];

/** GET /webauthn_credentials, newest first (the server orders it). */
export const usePasskeys = () => {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: passkeysKey,
    queryFn: guardedQueryFn(passkeysKey, () => listPasskeys()),
    enabled: authReady,
  });
};

/**
 * Registration options -> platform ceremony -> POST /webauthn_credentials/
 * registration. The whole ceremony is the mutation, so the button's pending
 * state covers the system sheet too.
 */
export const useRegisterPasskey = () => {
  const queryClient = useQueryClient();
  return useMutation<PasskeySummary, unknown, string | undefined>({
    mutationFn: (nickname) => createPasskey(nickname),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: passkeysKey });
    },
  });
};

export const useDeletePasskey = () => {
  const queryClient = useQueryClient();
  return useMutation<void, unknown, string>({
    mutationFn: (id) => deletePasskey(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: passkeysKey });
    },
  });
};
