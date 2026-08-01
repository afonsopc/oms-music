/** User hooks. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getUser, updateUser } from "../endpoints/users";
import { keys } from "../queryKeys";
import { guardedQueryFn } from "./common";
import { useAuthReady } from "@/auth/guard";
import type { UserId } from "@/domain/ids";

export const useUser = (id: UserId | null, enabled = true) => {
  const authReady = useAuthReady();
  const key = keys.user(id ?? "");
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, () => getUser(id as UserId)),
    enabled: authReady && enabled && !!id,
  });
};

/** Multipart PATCH /users/:id (share_listening writes, FR-98). */
export const useUpdateUser = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      fields,
    }: {
      id: UserId;
      fields: Parameters<typeof updateUser>[1];
    }) => updateUser(id, fields),
    onSuccess: (user) => {
      qc.setQueryData(keys.user(user.id), user);
    },
  });
};
