import { beforeEach, describe, expect, it } from "bun:test";
import type { JamId, UserId } from "@/domain/ids";
import type { Jam, JamState } from "@/domain/jam";
import { JamManager, JOIN_GRACE_MS } from "../channel";
import { applyJam, jamStore, resetJamStore } from "../store";
import { createFakeApi, FakeCable, FakeFollower } from "./fakes";

const ME = "u_me" as UserId;
const HOST = "u_host" as UserId;

const jam = (over: Partial<Jam> = {}): Jam => ({
  id: 7 as JamId,
  host_id: HOST,
  queue_mode: "everyone",
  skip_mode: "majority",
  created_at: "2026-01-01T00:00:00Z",
  ended_at: null,
  members: [{ id: HOST, handle: "host", name: "Host", is_host: true, joined_at: "x" }],
  ...over,
});

const state = (songId: string | null, over: Partial<JamState> = {}): JamState => ({
  song:
    songId === null
      ? null
      : ({
          id: songId,
          title: `Song ${songId}`,
          album: null,
          duration: 200,
          owner_id: HOST,
          // The wire really does send a comma-joined string here; the frozen
          // domain type says string[] (see the WP10 handover note).
          artist_names: "Someone",
          artwork_url: null,
          audio_url: `https://presigned.example/${songId}`,
        } as unknown as JamState["song"]),
  position: 10,
  paused: false,
  server_time: 1_000,
  ...over,
});

interface Harness {
  manager: JamManager;
  cable: FakeCable;
  follower: FakeFollower;
  notices: string[];
  claims: number;
  pauses: number;
  calls: ReturnType<typeof createFakeApi>["calls"];
  setNow(ms: number): void;
}

const harness = (opts: { jam?: Jam; current?: Jam | null } = {}): Harness => {
  const cable = new FakeCable();
  const follower = new FakeFollower();
  const notices: string[] = [];
  let claims = 0;
  let pauses = 0;
  let now = 10_000;
  const { api, calls } = createFakeApi({
    jam: opts.jam ?? jam(),
    index: { current: opts.current ?? null, joinable: [] },
  });
  const manager = new JamManager({
    cable,
    api,
    follower,
    claimActiveSteal: () => {
      claims += 1;
    },
    pauseLocalPlayback: () => {
      pauses += 1;
    },
    notify: (notice) => notices.push(notice.key),
    now: () => now,
  });
  return {
    manager,
    cable,
    follower,
    notices,
    calls,
    get claims() {
      return claims;
    },
    get pauses() {
      return pauses;
    },
    setNow: (ms: number) => {
      now = ms;
    },
  } as Harness;
};

beforeEach(() => resetJamStore());

describe("jam lifecycle (FR-113)", () => {
  it("resumes an in-progress jam from GET /jams on start", async () => {
    const existing = jam({ id: 99 as JamId });
    const h = harness({ current: existing });
    h.manager.start(ME);
    await Promise.resolve();
    await Promise.resolve();
    expect(jamStore.getState().jam?.id).toBe(99);
    expect(h.cable.live("JamChannel")?.params).toEqual({ channel: "JamChannel", id: 99 });
  });

  it("creating a jam steals the active playback device (silent jam otherwise)", async () => {
    const h = harness({ jam: jam({ host_id: ME }) });
    h.manager.start(ME);
    await h.manager.createJam();
    expect(h.claims).toBe(1);
    expect(h.cable.live("JamChannel")).not.toBeNull();
  });

  it("joins over REST BEFORE subscribing, and silences local playback first", async () => {
    const h = harness();
    h.manager.start(ME);
    await h.manager.joinJam(7 as JamId);
    expect(h.pauses).toBe(1);
    expect(h.calls.joined).toEqual([7 as JamId]);
    expect(h.cable.live("JamChannel")).not.toBeNull();
  });

  it("a channel rejection means the jam is gone: clear, never retry", async () => {
    const h = harness();
    h.manager.start(ME);
    await h.manager.joinJam(7 as JamId);
    h.cable.reject("JamChannel");
    expect(jamStore.getState().jam).toBeNull();
    expect(h.follower.stops).toBeGreaterThan(0);
  });

  it("host leaving arrives as `ended` and wipes the jam for the member", async () => {
    const h = harness();
    h.manager.start(ME);
    await h.manager.joinJam(7 as JamId);
    h.cable.emit("JamChannel", { type: "ended" });
    expect(jamStore.getState().jam).toBeNull();
    expect(h.notices).toContain("components.music.JamProvider.jamEnded");
  });
});

describe("jam channel messages (FR-114)", () => {
  const joined = async (over: Partial<Jam> = {}): Promise<Harness> => {
    const h = harness({ jam: jam(over) });
    h.manager.start(ME);
    await h.manager.joinJam(7 as JamId);
    return h;
  };

  it("drives the follower from snapshot and state_changed", async () => {
    const h = await joined();
    h.cable.emit("JamChannel", { type: "snapshot", jam: jam(), state: state("1") });
    expect(h.follower.states).toHaveLength(1);
    h.cable.emit("JamChannel", { type: "state_changed", state: state("1", { paused: true }) });
    expect(h.follower.states).toHaveLength(2);
    expect(jamStore.getState().state?.paused).toBeTruthy();
  });

  it("resets the skip tally SILENTLY when the state song id changes", async () => {
    const h = await joined();
    h.cable.emit("JamChannel", { type: "state_changed", state: state("1") });
    h.cable.emit("JamChannel", { type: "skip_votes", song_id: "1", count: 1, needed: 2 });
    expect(jamStore.getState().skipVotes).toEqual({ count: 1, needed: 2 });

    // Same song again: the tally survives a plain pause broadcast.
    h.cable.emit("JamChannel", { type: "state_changed", state: state("1", { paused: true }) });
    expect(jamStore.getState().skipVotes).toEqual({ count: 1, needed: 2 });

    h.cable.emit("JamChannel", { type: "state_changed", state: state("2") });
    expect(jamStore.getState().skipVotes).toBeNull();
  });

  it("forwards ticks to the follower and patches the stored position", async () => {
    const h = await joined();
    h.cable.emit("JamChannel", { type: "state_changed", state: state("1") });
    h.cable.emit("JamChannel", {
      type: "position_tick",
      position: 42,
      paused: false,
      song_id: "1",
      server_time: 2_000,
    });
    expect(h.follower.ticks).toEqual([{ position: 42, paused: false, songId: "1" }]);
    expect(jamStore.getState().state?.position).toBe(42);
  });

  it("drops a tick that raced a track change", async () => {
    const h = await joined();
    h.cable.emit("JamChannel", { type: "state_changed", state: state("2") });
    h.cable.emit("JamChannel", {
      type: "position_tick",
      position: 180,
      paused: false,
      song_id: "1",
    });
    expect(h.follower.ticks).toHaveLength(0);
    expect(jamStore.getState().state?.position).toBe(10);
  });

  it("never drives audio on the HOST: they are the source", async () => {
    const h = await joined({ host_id: ME });
    h.cable.emit("JamChannel", { type: "state_changed", state: state("1") });
    h.cable.emit("JamChannel", {
      type: "position_tick",
      position: 42,
      paused: false,
      song_id: "1",
    });
    expect(h.follower.states).toHaveLength(0);
    expect(h.follower.ticks).toHaveLength(0);
    // The host still consumes the state for the panel.
    expect(jamStore.getState().state?.song?.id).toBe("1");
  });

  it("keeps members and rules fresh from members_changed / jam_updated", async () => {
    const h = await joined();
    h.cable.emit("JamChannel", { type: "jam_updated", jam: jam({ queue_mode: "host" }) });
    expect(jamStore.getState().jam?.queue_mode).toBe("host");
    h.cable.emit("JamChannel", {
      type: "members_changed",
      jam: jam({ members: [] }),
    });
    expect(jamStore.getState().jam?.members).toHaveLength(0);
  });

  it("announces proposals and skips without touching the queue", async () => {
    const h = await joined();
    h.cable.emit("JamChannel", {
      type: "song_proposed",
      song: { id: "3", title: "Nova" },
      proposer: { id: "u_x", handle: "x" },
    });
    expect(h.notices).toContain("components.music.JamProvider.songProposed");
    h.cable.emit("JamChannel", { type: "skip_votes", count: 1, needed: 2 });
    h.cable.emit("JamChannel", { type: "skipped" });
    expect(jamStore.getState().skipVotes).toBeNull();
  });
});

describe("auto-leave on local playback (FR-115)", () => {
  it("ignores local playback inside the join grace", async () => {
    const h = harness();
    h.manager.start(ME);
    await h.manager.joinJam(7 as JamId);
    h.setNow(10_000 + JOIN_GRACE_MS - 1);
    h.manager.onLocalPlaybackStarted();
    expect(jamStore.getState().jam).not.toBeNull();
  });

  it("leaves once the grace has passed", async () => {
    const h = harness();
    h.manager.start(ME);
    await h.manager.joinJam(7 as JamId);
    h.setNow(10_000 + JOIN_GRACE_MS + 1);
    h.manager.onLocalPlaybackStarted();
    expect(jamStore.getState().jam).toBeNull();
    expect(h.notices).toContain("components.music.JamProvider.leftJamLocalPlayback");
  });

  it("never auto-leaves a jam we HOST (the host is the one playing)", async () => {
    const h = harness({ jam: jam({ host_id: ME }) });
    h.manager.start(ME);
    await h.manager.createJam();
    h.setNow(10_000 + JOIN_GRACE_MS + 1);
    h.manager.onLocalPlaybackStarted();
    expect(jamStore.getState().jam).not.toBeNull();
  });
});

describe("skip votes (FR-117)", () => {
  it("shows a pending tally but not a passed one", async () => {
    const h = harness();
    h.manager.start(ME);
    await h.manager.joinJam(7 as JamId);
    await h.manager.voteSkip();
    expect(jamStore.getState().skipVotes).toEqual({ count: 1, needed: 2 });

    resetJamStore();
    applyJam({ myUserId: ME, jam: jam() });
    const passed = harness();
    const { api } = createFakeApi({
      jam: jam(),
      vote: { skipped: true, count: 2, needed: 2 },
    });
    // Re-point the manager at an api whose vote passes.
    const manager = new JamManager({
      cable: passed.cable,
      api,
      follower: passed.follower,
      claimActiveSteal: () => {},
      pauseLocalPlayback: () => {},
      notify: () => {},
    });
    manager.start(ME);
    await manager.joinJam(7 as JamId);
    await manager.voteSkip();
    expect(jamStore.getState().skipVotes).toBeNull();
  });
});
