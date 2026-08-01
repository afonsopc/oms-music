/** Vocal separation REST. Terminal statuses are complete|failed ONLY (no
 *  "canceled" exists server-side). Poll ~3s while pending/processing. */
import { request } from "../client";
import type { SongId } from "@/domain/ids";
import type { SongSeparationStatus, VocalSeparation } from "@/domain/song";

export const startSeparation = (
  songId: SongId,
  modelId?: string,
): Promise<VocalSeparation> =>
  request("POST", `/songs/${songId}/separate`, {
    body: modelId ? { model_id: modelId } : {},
  });

export const getSeparation = (songId: SongId): Promise<SongSeparationStatus> =>
  request("GET", `/songs/${songId}/separation`);

/** Deletes both stems; the original audio is kept. */
export const deleteSeparation = (songId: SongId): Promise<void> =>
  request("DELETE", `/songs/${songId}/separation`);
