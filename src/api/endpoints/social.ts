/** Social REST: music profiles (FR-120). Presigned media in the payload is
 *  used AS-IS; never resolve another user's fs nodes. */
import { request } from "../client";
import type { MusicProfile } from "@/domain/social";

/** { visible: false } is a 200 for strangers/private accounts. */
export const getMusicProfile = (idOrHandle: string): Promise<MusicProfile> =>
  request("GET", `/users/${encodeURIComponent(idOrHandle)}/music_profile`);
