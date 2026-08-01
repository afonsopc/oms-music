/** Radios REST. 404 when unbuildable (not an empty list). Titles are
 *  pre-baked Portuguese - render as-is (FR-122). */
import { request } from "../client";
import type { SongId } from "@/domain/ids";
import type { Radio } from "@/domain/mixes";

export const getArtistRadio = (slugOrName: string): Promise<Radio> =>
  request("GET", `/music_radios/artist/${encodeURIComponent(slugOrName)}`, {
    timeoutMs: 60_000,
  });

export const getSongRadio = (songId: SongId): Promise<Radio> =>
  request("GET", `/music_radios/song/${songId}`, { timeoutMs: 60_000 });
