/** Relationships REST. Friends = kind "friend" + status "accepted"; take the
 *  other side of requester/accepter (FR-118). */
import { request } from "../client";
import type { UserId } from "@/domain/ids";
import type { Relationship } from "@/domain/user";

export const listRelationships = (): Promise<Relationship[]> =>
  request("GET", "/relationships");

/** Accepted friends of the given user id, as the "other side" rows. */
export const acceptedFriends = (
  relationships: Relationship[],
  selfId: UserId,
): { id: UserId; handle: string; name: string }[] =>
  relationships
    .filter((r) => r.kind === "friend" && r.status === "accepted")
    .map((r) => (r.requester_id === selfId ? r.accepter : r.requester))
    .filter((u): u is { id: UserId; handle: string; name: string } => !!u);
