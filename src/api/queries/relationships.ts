/**
 * Relationship hooks: accepted-friends source for jam invites (FR-118).
 * Friends = kind "friend" + status "accepted"; take the other side of
 * requester/accepter.
 */
import { useQuery } from "@tanstack/react-query";
import { oms } from "../oms";
import { keys } from "../queryKeys";
import { guardedQueryFn } from "./common";
import { useAuthReady } from "@/auth/guard";
import type { UserId } from "@/domain/ids";
import type { Relationship } from "@/domain/user";

/** Every relationship row of the caller (the SDK walks the pages at 500). */
export const listRelationships = (): Promise<Relationship[]> =>
  oms().social.relationships.all({}, 2000) as Promise<Relationship[]>;

/** Accepted friends of the given user id, as the "other side" rows. */
export const acceptedFriends = (
  relationships: Relationship[],
  selfId: UserId,
): { id: UserId; handle: string; name: string }[] =>
  relationships
    .filter((r) => r.kind === "friend" && r.status === "accepted")
    .map((r) => (r.requester_id === selfId ? r.accepter : r.requester))
    .filter((u): u is { id: UserId; handle: string; name: string } => !!u);

export const useRelationships = (enabled = true) => {
  const authReady = useAuthReady();
  const key = keys.relationships;
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, () => listRelationships()),
    enabled: authReady && enabled,
  });
};
