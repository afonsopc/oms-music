/** Relationship hooks: accepted-friends source for jam invites (FR-118). */
import { useQuery } from "@tanstack/react-query";
import { listRelationships } from "../endpoints/relationships";
import { keys } from "../queryKeys";
import { guardedQueryFn } from "./common";
import { useAuthReady } from "@/auth/guard";

export const useRelationships = (enabled = true) => {
  const authReady = useAuthReady();
  const key = keys.relationships;
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, () => listRelationships()),
    enabled: authReady && enabled,
  });
};
