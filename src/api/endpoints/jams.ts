/** Jams REST (API.md section 12). Join BEFORE subscribing JamChannel; the
 *  host leaving ENDS the jam (no handoff). */
import { request } from "../client";
import type { JamId, SongId, UserId } from "@/domain/ids";
import type { Jam, JamsIndex, SkipVoteResult } from "@/domain/jam";

export const getJams = (): Promise<JamsIndex> => request("GET", "/jams");

/** Caller becomes host + first member; must then claim_active (steal). */
export const createJam = (): Promise<Jam> => request("POST", "/jams");

export const joinJam = (id: JamId): Promise<Jam> => request("POST", `/jams/${id}/join`);

/** 200 null; HOST leaving ends the jam. */
export const leaveJam = (id: JamId): Promise<null> => request("POST", `/jams/${id}/leave`);

/** Host only. */
export const endJam = (id: JamId): Promise<void> => request("DELETE", `/jams/${id}`);

export const updateJamRules = (
  id: JamId,
  rules: { queue_mode?: "everyone" | "host"; skip_mode?: "majority" | "host" | "anyone" },
): Promise<Jam> => request("PATCH", `/jams/${id}`, { body: rules });

/** Target must be the caller's accepted friend and not already a member. */
export const inviteToJam = (id: JamId, userId: UserId): Promise<unknown> =>
  request("POST", `/jams/${id}/invite`, { body: { user_id: userId } });

/** Member's OWN song only; 400 without an active host device. */
export const proposeJamSong = (id: JamId, songId: SongId): Promise<unknown> =>
  request("POST", `/jams/${id}/propose`, { body: { song_id: songId } });

export const jamSkipVote = (id: JamId): Promise<SkipVoteResult> =>
  request("POST", `/jams/${id}/skip_vote`);
