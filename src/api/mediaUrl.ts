/**
 * Media URL builders (FR-2). `/fs_nodes/:id/data?token=` is 302-following and
 * rate-limit EXEMPT: use it for ALL images and downloads. Presigned resolution
 * (`data_url`) COUNTS against the 600/min ceiling and is reserved for the
 * player's resolver cache. Cache media by fs node id, NEVER by URL.
 */
import { API_BASE_URL } from "./client";
import type { FsNodeId, UserId } from "@/domain/ids";
import { getToken } from "@/auth/token";

/** Authenticated image/bytes URL for an fs node. */
export const imageUrl = (nodeId: FsNodeId): string => {
  const token = getToken();
  const base = `${API_BASE_URL}/fs_nodes/${encodeURIComponent(nodeId)}/data`;
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
};

/** Download source URL, built at DEQUEUE time (same route, never expires). */
export const downloadUrl = imageUrl;

/** Avatars are public: NO token (safe for lock-screen artwork too). */
export const avatarUrl = (userId: UserId): string =>
  `${API_BASE_URL}/users/${encodeURIComponent(userId)}/picture`;
