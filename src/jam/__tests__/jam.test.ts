import { beforeEach, describe, expect, it } from "bun:test";
import type { UserId } from "@/domain/ids";
import type { Jam, JamState } from "@/domain/jam";
import { extrapolateTick, planTick, MAX_DRIFT_SECONDS } from "../followerPlayer";
import { normalizeProposal } from "../hostDuties";
import {
  applyJam,
  jamStore,
  resetJamStore,
  selectCanPropose,
  selectCanVoteSkip,
  selectFollowing,
  selectIsHost,
} from "../store";
import type { Song } from "@/domain/song";

const ME = "u_me" as UserId;
const HOST = "u_host" as UserId;

const jam = (over: Partial<Jam> = {}): Jam => ({
  id: 42,
  host_id: HOST,
  queue_mode: "everyone",
  skip_mode: "majority",
  created_at: "2026-01-01T00:00:00Z",
  ended_at: null,
  members: [],
  ...over,
});

describe("follower drift correction (FR-114/115)", () => {
  it("hard-pauses whenever the host is paused, whatever the local state", () => {
    const plan = planTick({
      hostPaused: true,
      localPaused: false,
      playing: true,
      localPosition: 10,
      tickPosition: 60,
    });
    expect(plan).toEqual({ pause: true, play: false, seekTo: null });
  });

  it("rides a drift at or below the 2.5 s ceiling instead of stuttering", () => {
    const plan = planTick({
      hostPaused: false,
      localPaused: false,
      playing: true,
      localPosition: 10,
      tickPosition: 10 + MAX_DRIFT_SECONDS,
    });
    expect(plan.seekTo).toBeNull();
    expect(plan.play).toBeFalsy();
  });

  it("hard-seeks past the ceiling, in both directions", () => {
    expect(
      planTick({
        hostPaused: false,
        localPaused: false,
        playing: true,
        localPosition: 10,
        tickPosition: 20,
      }).seekTo,
    ).toBe(20);
    expect(
      planTick({
        hostPaused: false,
        localPaused: false,
        playing: true,
        localPosition: 40,
        tickPosition: 20,
      }).seekTo,
    ).toBe(20);
  });

  it("resumes a stalled follower whose host is playing", () => {
    const plan = planTick({
      hostPaused: false,
      localPaused: false,
      playing: false,
      localPosition: 10,
      tickPosition: 10,
    });
    expect(plan.play).toBeTruthy();
  });

  it("never touches audio while the follower paused locally", () => {
    const plan = planTick({
      hostPaused: false,
      localPaused: true,
      playing: false,
      localPosition: 0,
      tickPosition: 120,
    });
    expect(plan).toEqual({ pause: false, play: false, seekTo: null });
  });

  it("extrapolates the last tick so resume rejoins live, not the pause point", () => {
    const tick = { position: 30, paused: false, songId: "1", receivedAtMs: 1_000 };
    expect(extrapolateTick(tick, 6_000)).toBe(35);
    // A paused host does not move: extrapolation would run past the truth.
    expect(extrapolateTick({ ...tick, paused: true }, 6_000)).toBe(30);
  });
});

describe("jam roles (FR-113/117)", () => {
  beforeEach(() => resetJamStore());

  it("derives host and follower from the jam host id", () => {
    applyJam({ myUserId: ME, jam: jam({ host_id: ME }) });
    expect(selectIsHost(jamStore.getState())).toBeTruthy();
    expect(selectFollowing(jamStore.getState())).toBeFalsy();

    applyJam({ jam: jam({ host_id: HOST }) });
    expect(selectIsHost(jamStore.getState())).toBeFalsy();
    expect(selectFollowing(jamStore.getState())).toBeTruthy();
  });

  it("opens proposals only to followers of an everyone-mode jam", () => {
    applyJam({ myUserId: ME, jam: jam({ queue_mode: "everyone" }) });
    expect(selectCanPropose(jamStore.getState())).toBeTruthy();

    applyJam({ jam: jam({ queue_mode: "host" }) });
    expect(selectCanPropose(jamStore.getState())).toBeFalsy();

    // The host plays through their own queue; proposing to themselves is not
    // an interception path.
    applyJam({ jam: jam({ host_id: ME, queue_mode: "everyone" }) });
    expect(selectCanPropose(jamStore.getState())).toBeFalsy();
  });

  it("hides the vote UI for non-hosts in host skip mode (FR-117 AC)", () => {
    applyJam({ myUserId: ME, jam: jam({ skip_mode: "host" }) });
    expect(selectCanVoteSkip(jamStore.getState())).toBeFalsy();

    applyJam({ jam: jam({ skip_mode: "host", host_id: ME }) });
    expect(selectCanVoteSkip(jamStore.getState())).toBeTruthy();

    applyJam({ jam: jam({ skip_mode: "anyone" }) });
    expect(selectCanVoteSkip(jamStore.getState())).toBeTruthy();
  });

  it("keeps the identity but drops the jam on reset", () => {
    applyJam({ myUserId: ME, jam: jam(), skipVotes: { count: 1, needed: 2 } });
    resetJamStore();
    expect(jamStore.getState().jam).toBeNull();
    expect(jamStore.getState().skipVotes).toBeNull();
  });
});

describe("host duties (FR-116)", () => {
  it("marks every server-built proposal as a jam song for the three guards", () => {
    const proposal = {
      id: 7,
      title: "Proposed",
      audio_url: "https://presigned.example/song.m4a",
    } as unknown as Song;
    const normalized = normalizeProposal(proposal);
    expect(normalized.jam_song).toBeTruthy();
    // The presigned URL survives: the host cannot resolve the proposer's
    // fs nodes, so the source ladder needs it verbatim.
    expect(normalized.audio_url).toBe("https://presigned.example/song.m4a");
  });
});

describe("jam state shape", () => {
  it("treats an absent song as nothing playing", () => {
    const state: JamState = { song: null, position: 0, paused: true, server_time: 0 };
    expect(state.song).toBeNull();
  });
});
