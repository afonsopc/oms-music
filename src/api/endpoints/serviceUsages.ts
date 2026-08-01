/** Recent-services ping (FR-22): fire-and-forget, no UI. */
import { request } from "../client";

export const postMusicServiceUsage = (): Promise<unknown> =>
  request("POST", "/service_usages", { body: { service_id: "music" } });
