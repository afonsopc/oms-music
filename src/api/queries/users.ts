/** User hooks. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UpdateAccountInput } from "@omelhorsite/sdk";
import { oms } from "../oms";
import { keys } from "../queryKeys";
import { guardedQueryFn } from "./common";
import { useAuthReady } from "@/auth/guard";
import type { UserId } from "@/domain/ids";
import type { User } from "@/domain/user";

export const getUser = (id: UserId): Promise<User> =>
  oms().account.get(id) as Promise<User>;

export const useUser = (id: UserId | null, enabled = true) => {
  const authReady = useAuthReady();
  const key = keys.user(id ?? "");
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, () => getUser(id as UserId)),
    enabled: authReady && enabled && !!id,
  });
};

/**
 * PATCH /users/:id on the signed-in account (share_listening writes, FR-98).
 * The SDK resolves the id itself (one GET /account first) and sends JSON; the
 * multipart shape is only needed for the picture, which this app never sends.
 */
export const useUpdateUser = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fields: UpdateAccountInput) => oms().account.update(fields) as Promise<User>,
    onSuccess: (user) => {
      qc.setQueryData(keys.user(user.id), user);
    },
  });
};
