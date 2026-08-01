/**
 * fs_nodes REST. `data_url` mints a DIFFERENT presigned URL on every resolve
 * (6h validity) and COUNTS against the rate ceiling - only the player's
 * resolver cache (WP3) calls this. Images and downloads use
 * api/mediaUrl.imageUrl (`/data?token=`, redirect-following, rate-exempt).
 */
import { request } from "../client";
import type { FsNodeId } from "@/domain/ids";

export const resolveDataUrl = async (nodeId: FsNodeId): Promise<string> => {
  const response = await request<{ url: string }>(
    "GET",
    `/fs_nodes/${encodeURIComponent(nodeId)}/data_url`,
  );
  return response.url;
};
