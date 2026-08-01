/** Mixes REST. Slugs contain ":" - URL-ENCODE them. 404 on a rotated slug
 *  means refetch the list (FR-121). */
import { request } from "../client";
import type { Mix, MixSummary } from "@/domain/mixes";

export const listMixes = (): Promise<MixSummary[]> => request("GET", "/music_mixes");

export const getMix = (slug: string): Promise<Mix> =>
  request("GET", `/music_mixes/${encodeURIComponent(slug)}`);
