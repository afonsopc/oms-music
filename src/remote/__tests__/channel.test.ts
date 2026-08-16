import { afterEach, describe, expect, it } from "bun:test";
import { PlaybackChannelManager } from "../channel";
import { remoteStore, resetRemoteStore } from "../store";
import { createRemoteTransportDecorator } from "../transport";
import { FakeCable, FakeEngine, FakeLocalState, fakeSong, wireSnapshot } from "./fakes";
import type { TransportActions } from "@/contracts/transport";

const ME = "sess:me";
const OTHER = "sess:other";

interface Harness {
  cable: FakeCable;
  engine: FakeEngine;
  local: FakeLocalState;
  channel: PlaybackChannelManager;
  lockScreenSongs: (string | null)[];
  notices: string[];
}

let active: Harness | null = null;

const start = (over: Partial<{ localPlaying: boolean }> = {}): Harness => {
  const cable = new FakeCable();
  const engine = new FakeEngine();
  const local = new FakeLocalState({ playing: !!over.localPlaying });
  const lockScreenSongs: (string | null)[] = [];
  const notices: string[] = [];
  const channel = new PlaybackChannelManager({
    cable,
    engine,
    localState: local,
    deviceId: "device-abcdefgh",
    deviceLabel: "Pixel - Android",
    setLockScreenSong: (song) => lockScreenSongs.push(song ? String(song.id) : null),
    notify: (notice) => notices.push(notice.kind),
  });
  channel.start();
  const harness = { cable, engine, local, channel, lockScreenSongs, notices };
  active = harness;
  return harness;
};

afterEach(() => {
  active?.channel.stop();
  active = null;
  resetRemoteStore();
});

const snapshotFrame = (over: Record<string, unknown> = {}) => ({
  type: "snapshot",
  your_device_id: ME,
  active_device_id: null,
  devices: [{ id: ME, label: "Pixel", device_type: "mobile", online: true }],
  state: wireSnapshot(),
  ...over,
});

describe("PlaybackChannel subscribe + presence (FR-105/106)", () => {
  it("subscribes with a byte-stable identifier and no predecessor", () => {
    const { cable } = start();
    expect(cable.params).toEqual({
      channel: "PlaybackChannel",
      device_id: "device-abcdefgh",
      device_label: "Pixel - Android",
    });
    expect(Object.keys(cable.params ?? {})).toEqual(["channel", "device_id", "device_label"]);
  });

  it("heartbeats immediately and wakes with request_snapshot + heartbeat", () => {
    const { cable } = start();
    expect(cable.actions()).toContain("heartbeat");
    cable.notifyForeground();
    expect(cable.actions().slice(-2)).toEqual(["request_snapshot", "heartbeat"]);
  });

  it("treats confirm/reject as the readiness and auth signals", () => {
    const { cable } = start();
    cable.confirm();
    expect(remoteStore.getState().ready).toBeTruthy();
    cable.reject();
    expect(remoteStore.getState().ready).toBeFalsy();
  });
});

describe("role machine (FR-107)", () => {
  it("stays offline until the first snapshot", () => {
    start();
    expect(remoteStore.getState().role).toBe("offline");
  });

  it("derives no_active, then active on an id match", () => {
    const { cable } = start();
    cable.push(snapshotFrame());
    expect(remoteStore.getState().role).toBe("no_active");
    cable.push({ type: "devices_changed", active_device_id: ME, devices: [] });
    expect(remoteStore.getState().role).toBe("active");
  });

  it("force-pauses and clears the source on becoming a controller", () => {
    const { cable, engine, lockScreenSongs } = start();
    cable.push(snapshotFrame({ active_device_id: OTHER }));
    expect(remoteStore.getState().role).toBe("controller");
    expect(engine.calls).toContain("stopAndClearSource");
    // Lock-screen metadata follows the song the user hears about.
    expect(lockScreenSongs).toEqual(["1"]);
    cable.push({ type: "devices_changed", active_device_id: null, devices: [] });
    expect(lockScreenSongs).toEqual(["1", null]);
  });
});

describe("cold-start hydration (FR-108)", () => {
  it("adopts the snapshot paused when nobody is active and the queue is empty", () => {
    const { cable, engine } = start();
    cable.push(snapshotFrame({ state: wireSnapshot({ position: 42 }) }));
    expect(engine.adopted?.cause).toBe("hydration");
    expect(engine.adopted?.position).toBe(42);
    expect(engine.adopted?.paused).toBeTruthy();
  });

  it("never adopts over a queue this device already has", () => {
    const { cable, engine } = start();
    engine.setQueue([fakeSong(9)]);
    cable.push(snapshotFrame());
    expect(engine.adopted).toBeNull();
  });

  it("ignores a snapshot whose only entries are jam proposals", () => {
    const { cable, engine } = start();
    cable.push(
      snapshotFrame({
        state: wireSnapshot({ queue_songs: [fakeSong(5, { jam_song: true })], queue_order: [0] }),
      }),
    );
    expect(engine.adopted).toBeNull();
  });
});

describe("transfer in (FR-111)", () => {
  it("adopts the snapshot and suppresses publishes until the first audible frame", () => {
    const { cable, engine } = start();
    cable.push(snapshotFrame({ active_device_id: OTHER }));
    cable.push({
      type: "state_changed",
      active_device_id: ME,
      state: wireSnapshot({ paused: false, position: 61 }),
    });
    expect(engine.adopted?.cause).toBe("activation");
    expect(engine.adopted?.position).toBe(61);
    expect(remoteStore.getState().activating).toBeTruthy();
    // No state_changed publish while activating.
    expect(cable.actions()).not.toContain("state_changed");
    engine.emit("audiblePlaying", { songKey: "1" });
    expect(remoteStore.getState().activating).toBeFalsy();
    expect(cable.actions()).toContain("state_changed");
    expect(cable.actions()).toContain("position_tick");
  });

  it("does not re-adopt on a self-initiated takeover", () => {
    const { cable, engine, channel } = start();
    cable.push(snapshotFrame({ active_device_id: OTHER }));
    engine.adopted = null;
    channel.markTakeover();
    channel.claimActive("steal");
    expect(remoteStore.getState().role).toBe("active");
    expect(engine.adopted).toBeNull();
  });
});

describe("reconnect steal (FR-112)", () => {
  it("steals back and force-publishes when the drop happened while active", () => {
    const { cable, engine } = start();
    cable.push(snapshotFrame({ active_device_id: ME }));
    cable.emitState("disconnected");
    // Local audio never stopped through the blip.
    expect(engine.calls).not.toContain("stopAndClearSource");
    engine.adopted = null;
    cable.push(snapshotFrame({ active_device_id: null }));
    expect(cable.last("claim_active")?.data).toEqual({ mode: "steal" });
    expect(remoteStore.getState().role).toBe("active");
    expect(engine.adopted).toBeNull();
    expect(cable.actions()).toContain("state_changed");
  });

  it("does not steal when another device claimed meanwhile", () => {
    const { cable } = start();
    cable.push(snapshotFrame({ active_device_id: ME }));
    cable.emitState("disconnected");
    cable.push(snapshotFrame({ active_device_id: OTHER }));
    expect(cable.last("claim_active")).toBeUndefined();
    expect(remoteStore.getState().role).toBe("controller");
  });
});

describe("controller mirroring (FR-109)", () => {
  it("merges slim state_changed frames with the last full queue_songs", () => {
    const { cable } = start();
    cable.push(snapshotFrame({ active_device_id: OTHER }));
    const slim = wireSnapshot({ paused: true });
    delete slim.queue_songs;
    cable.push({ type: "state_changed", active_device_id: OTHER, state: slim });
    expect(remoteStore.getState().snapshot?.queue_songs).toHaveLength(2);
  });

  it("drops ticks whose song id does not match the snapshot", () => {
    const { cable } = start();
    cable.push(snapshotFrame({ active_device_id: OTHER }));
    cable.push({ type: "position_tick", position: 10, paused: false, song_id: "999" });
    expect(remoteStore.getState().controllerPaused).toBeTruthy();
    cable.push({ type: "position_tick", position: 10, paused: false, song_id: "1" });
    expect(remoteStore.getState().controllerPaused).toBeFalsy();
  });

  it("resyncs instead of retrying when the server rejects a send", () => {
    const { cable, notices } = start();
    cable.push({ type: "error", action: "state_changed", reason: "not_active_device" });
    expect(cable.last("request_snapshot")).toBeTruthy();
    // Nothing was transferred, so nothing is announced.
    expect(notices).toEqual([]);
  });
});

/**
 * Owner report 2026-08-16, point 6: "choosing another device does nothing, or
 * it moves the music to the phone but PAUSED". Both halves are the same
 * defect - the transfer had no acknowledgement channel, and every ambiguity
 * in the path resolved to paused.
 */
describe("transfer (FR-111 owner report 2026-08-16)", () => {
  it("says so when the server refuses the transfer", () => {
    const { cable, notices } = start();
    cable.push(snapshotFrame({ active_device_id: OTHER }));

    // Registry rows outlive their device by up to 75 s and device ids are
    // per-launch, so the picker happily offers a ghost. This is what the
    // server answers, and it used to be swallowed whole.
    active!.channel.transferTo(OTHER);
    cable.push({ type: "error", action: "transfer", reason: "device_offline" });

    expect(notices).toEqual(["transfer_failed"]);
    expect(cable.last("request_snapshot")).toBeTruthy();
  });

  it("does not blame a transfer for an unrelated later error", () => {
    const { cable, notices } = start();
    cable.push(snapshotFrame({ active_device_id: OTHER }));
    active!.channel.transferTo(ME);
    // The transfer landed; anything failing after it is a different story.
    cable.push({ type: "state_changed", active_device_id: ME, state: wireSnapshot() });
    cable.push({ type: "error", action: "state_changed", reason: "not_active_device" });
    expect(notices).toEqual([]);
  });

  it("adopts the NEWEST tick, not the last full frame", () => {
    const { cable, engine } = start();
    // The other device published "paused at 0" a while ago and has been
    // ticking ever since - ticks carry position AND paused, and nothing was
    // folding them into what an activation adopts.
    cable.push(snapshotFrame({ active_device_id: OTHER }));
    cable.push({ type: "position_tick", position: 42, paused: false, song_id: "1" });

    // Activeness moves here WITHOUT a fresh state frame, which is exactly the
    // case that used to adopt the minute-old truth.
    cable.push({
      type: "devices_changed",
      active_device_id: ME,
      devices: [{ id: ME, label: "Pixel", device_type: "mobile", online: true }],
    });

    expect(engine.adopted?.cause).toBe("activation");
    expect(engine.adopted?.paused).toBe(false);
    expect(engine.adopted?.position).toBeGreaterThanOrEqual(42);
    expect(engine.adopted?.position).toBeLessThan(44);
  });

  it("keeps the roster's active device when a devices_changed omits it", () => {
    const { cable, engine } = start();
    cable.push(snapshotFrame({ active_device_id: OTHER }));
    const adoptionsBefore = engine.adopted;

    // Roster-only frame: no active_device_id KEY at all. Read literally it
    // demoted everyone to no_active, and the re-promotion that followed
    // re-adopted a snapshot on top of whatever was already playing.
    cable.push({
      type: "devices_changed",
      devices: [{ id: OTHER, label: "Mac", device_type: "desktop", online: true }],
    });

    expect(remoteStore.getState().activeDeviceId).toBe(OTHER);
    expect(remoteStore.getState().role).toBe("controller");
    expect(engine.adopted).toBe(adoptionsBefore);
  });
});

describe("activation_blocked notices (handoff 2026-08-17 §5.2)", () => {
  it("announces the OTHER device that needs a tap, and stays silent on its own echo", () => {
    const { cable, notices } = start();
    cable.push(snapshotFrame({ active_device_id: OTHER }));
    cable.push({ type: "activation_blocked", device_id: OTHER });
    expect(notices).toEqual(["device_needs_tap"]);
    expect(remoteStore.getState().blockedDeviceId).toBe(OTHER);

    // A frame naming SELF is the echo of this device's own perform: the
    // local warning already came from the activation watchdog, so the echo
    // must not toast a second time.
    cable.push({ type: "activation_blocked", device_id: ME });
    expect(notices).toEqual(["device_needs_tap"]);
  });
});

describe("roster receipt time (presence aging input)", () => {
  it("stamps devicesAt when a frame carries a roster and leaves it alone otherwise", () => {
    const { cable } = start();
    expect(remoteStore.getState().devicesAt).toBe(0);
    cable.push(snapshotFrame());
    const stamped = remoteStore.getState().devicesAt;
    expect(stamped).toBeGreaterThan(0);
    // Roster-less frames must not make a stale roster look fresh.
    cable.push({ type: "state_changed", active_device_id: OTHER, state: wireSnapshot() });
    expect(remoteStore.getState().devicesAt).toBe(stamped);
  });
});

describe("command routing (FR-109 executor)", () => {
  it("executes only commands targeted at this device", () => {
    const { cable, engine } = start();
    cable.push(snapshotFrame({ active_device_id: ME }));
    cable.push({ type: "command", command: "pause", args: {}, target_device_id: OTHER });
    expect(engine.calls).not.toContain("pause");
    cable.push({ type: "command", command: "pause", args: {}, target_device_id: ME });
    expect(engine.calls).toContain("pause");
  });
});

describe("transport decorator (FR-109/111, FR-63 remote half)", () => {
  const base: TransportActions & { calls: string[] } = {
    calls: [],
    play() {
      this.calls.push("play");
    },
    pause() {
      this.calls.push("pause");
    },
    toggle() {
      this.calls.push("toggle");
    },
    next() {
      this.calls.push("next");
    },
    previous() {
      this.calls.push("previous");
    },
    seek() {
      this.calls.push("seek");
    },
    setVolume() {
      this.calls.push("setVolume");
    },
    setRate() {
      this.calls.push("setRate");
    },
    setLoopMode() {
      this.calls.push("setLoopMode");
    },
    setShuffle() {
      this.calls.push("setShuffle");
    },
    setQueueIndex() {
      this.calls.push("setQueueIndex");
    },
    addToQueue() {
      this.calls.push("addToQueue");
    },
    playNext() {
      this.calls.push("playNext");
    },
    removeFromQueue() {
      this.calls.push("removeFromQueue");
    },
    reorderQueue() {
      this.calls.push("reorderQueue");
    },
    setQueue() {
      this.calls.push("setQueue");
    },
  };

  const decorate = (harness: Harness): TransportActions => {
    base.calls.length = 0;
    return createRemoteTransportDecorator({
      engine: harness.engine,
      localState: harness.local,
      sendCommand: (command, args) => harness.channel.sendCommand(command, args),
      claimActive: (mode) => harness.channel.claimActive(mode),
      markTakeover: () => harness.channel.markTakeover(),
      markSelfClaim: () => harness.channel.markSelfClaim(),
    })(base);
  };

  it("turns controller transport into validated commands", () => {
    const harness = start();
    const transport = decorate(harness);
    harness.cable.push(snapshotFrame({ active_device_id: OTHER }));
    transport.next();
    transport.seek(30);
    transport.setVolume(0.4);
    transport.addToQueue(fakeSong(7));
    const commands = harness.cable.sent
      .filter((f) => f.action === "command")
      .map((f) => f.data);
    expect(commands).toEqual([
      { command: "next", args: {} },
      { command: "seek", args: { time: 30 } },
      { command: "set_volume", args: { volume: 0.4 } },
      { command: "add_to_queue", args: { song_id: "7" } },
    ]);
    expect(base.calls).toEqual([]);
  });

  it("keeps device-local settings local even while controlling", () => {
    const harness = start();
    const transport = decorate(harness);
    harness.cable.push(snapshotFrame({ active_device_id: OTHER }));
    transport.setRate(1.25);
    expect(base.calls).toEqual(["setRate"]);
  });

  it("claims if_none pessimistically when playing with nobody active", () => {
    const harness = start();
    const transport = decorate(harness);
    harness.cable.push(snapshotFrame());
    transport.play();
    expect(harness.cable.last("claim_active")?.data).toEqual({ mode: "if_none" });
    // Optimistic activeness is NOT adopted for if_none.
    expect(remoteStore.getState().role).toBe("no_active");
    expect(harness.engine.calls).toContain("playFromIdle");
  });

  it("treats setQueue on a controller as a steal takeover, never a command", () => {
    const harness = start();
    const transport = decorate(harness);
    harness.cable.push(snapshotFrame({ active_device_id: OTHER }));
    harness.engine.adopted = null;
    transport.setQueue([fakeSong(3)]);
    expect(harness.cable.last("claim_active")?.data).toEqual({ mode: "steal" });
    expect(remoteStore.getState().role).toBe("active");
    expect(base.calls).toEqual(["setQueue"]);
    expect(harness.engine.adopted).toBeNull();
  });

  it("resumes at the SNAPSHOT position after a controller stint, not the frozen local one", () => {
    const harness = start();
    const transport = decorate(harness);
    // Another device takes over: this one goes silent, source cleared.
    harness.cable.push(snapshotFrame({ active_device_id: OTHER }));
    expect(harness.engine.calls).toContain("stopAndClearSource");
    // It plays on and then goes away, leaving nobody active.
    harness.cable.push({
      type: "state_changed",
      active_device_id: null,
      state: wireSnapshot({ song_id: "1", position: 180, paused: false }),
    });
    expect(remoteStore.getState().role).toBe("no_active");

    transport.play();
    expect(harness.engine.seeks).toEqual([180]);
    expect(harness.engine.calls).toContain("playFromIdle");
  });

  it("never re-seeks while the local source is still loaded", () => {
    const harness = start();
    const transport = decorate(harness);
    harness.cable.push(snapshotFrame({ state: wireSnapshot({ position: 180 }) }));
    expect(remoteStore.getState().role).toBe("no_active");
    transport.play();
    expect(harness.engine.seeks).toEqual([]);
  });

  it("never seeds a position from a snapshot describing another song", () => {
    const harness = start();
    const transport = decorate(harness);
    harness.cable.push(snapshotFrame({ active_device_id: OTHER }));
    harness.cable.push({
      type: "state_changed",
      active_device_id: null,
      state: wireSnapshot({ song_id: "2", position: 180, paused: false }),
    });
    transport.play();
    expect(harness.engine.seeks).toEqual([]);
  });
});
