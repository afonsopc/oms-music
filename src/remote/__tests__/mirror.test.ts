/**
 * The controller read half (FR-109): while another device owns audio every
 * player surface must render the MIRRORED snapshot, because the local store
 * still holds whatever this device last played (stopAndClearSource keeps the
 * quartet, the song, the position and the duration).
 */
import { describe, expect, it, beforeEach } from "bun:test";
import type { SongId } from "@/domain/ids";
import type { PlaybackSnapshot } from "@/domain/playback";
import type { Song } from "@/domain/song";
import { initialPlayerState, playerStore, resetPlayerStore } from "@/player/store";
import { computePlaybackView, getPlaybackView } from "../mirror";
import { applyRemote, initialRemoteState, resetRemoteStore, type RemoteStoreState } from "../store";

const song = (id: number, duration = 100): Song =>
  ({ id: id as SongId, title: `Song ${id}`, album: null, duration, artists: [] }) as unknown as Song;

const snapshot = (over: Partial<PlaybackSnapshot> = {}): PlaybackSnapshot => ({
  active_device_id: "s:other",
  song_id: "2",
  position: 12,
  paused: false,
  queue: ["1", "2"],
  queue_index: 1,
  queue_order: [0, 1],
  loop_mode: "one",
  shuffle: true,
  volume: 0.4,
  queue_songs: [song(1), song(2, 240)],
  ...over,
});

const controllerState = (over: Partial<RemoteStoreState> = {}): RemoteStoreState => ({
  ...initialRemoteState,
  role: "controller",
  yourDeviceId: "s:me",
  activeDeviceId: "s:other",
  snapshot: snapshot(),
  controllerPosition: 30,
  controllerPaused: false,
  ...over,
});

const localState = () => ({
  ...initialPlayerState,
  queue: [song(7)],
  queueOrder: [0],
  queueIndex: 0,
  currentSong: song(7, 180),
  position: 90,
  duration: 180,
  playing: true,
  volume: 1,
  loopMode: "all" as const,
});

describe("computePlaybackView", () => {
  it("passes the local store straight through when not controlling", () => {
    for (const role of ["offline", "no_active", "active"] as const) {
      const view = computePlaybackView(localState(), { ...initialRemoteState, role });
      expect(view.passive).toBe(false);
      expect(view.song?.id).toBe(7 as SongId);
      expect(view.position).toBe(90);
      expect(view.duration).toBe(180);
      expect(view.queueIndex).toBe(0);
      expect(view.volume).toBe(1);
      expect(view.loopMode).toBe("all");
    }
  });

  it("mirrors the snapshot while controlling instead of the stale local state", () => {
    const view = computePlaybackView(localState(), controllerState());
    expect(view.passive).toBe(true);
    // queue_order[queue_index] = 1 -> the SECOND song, not the local one.
    expect(view.song?.id).toBe(2 as SongId);
    expect(view.queue).toHaveLength(2);
    expect(view.queueIndex).toBe(1);
    expect(view.shuffle).toBe(true);
    expect(view.loopMode).toBe("one");
    // Volume is the active device's output: shared, unlike rate/EQ/modes.
    expect(view.volume).toBe(0.4);
  });

  it("takes position and paused from the ticks, which are fresher", () => {
    const view = computePlaybackView(
      localState(),
      controllerState({ controllerPosition: 30, controllerPaused: true }),
    );
    expect(view.position).toBe(30); // NOT the snapshot's 12, nor the local 90
    expect(view.playing).toBe(false);
    expect(view.buffering).toBe(false);
  });

  it("derives duration from the REMOTE song (a scrub maps drags with it)", () => {
    expect(computePlaybackView(localState(), controllerState()).duration).toBe(240);
  });

  it("survives a snapshot with no resolvable song", () => {
    const view = computePlaybackView(
      localState(),
      controllerState({ snapshot: snapshot({ queue_songs: [], queue_order: [] }) }),
    );
    expect(view.song).toBeNull();
    expect(view.duration).toBe(0);
    expect(view.queue).toHaveLength(0);
  });

  it("hands out referentially stable empties", () => {
    const bare = snapshot({ queue_songs: undefined, queue_order: undefined });
    const a = computePlaybackView(localState(), controllerState({ snapshot: bare }));
    const b = computePlaybackView(localState(), controllerState({ snapshot: bare }));
    expect(a.queue).toBe(b.queue);
    expect(a.queueOrder).toBe(b.queueOrder);
  });
});

describe("getPlaybackView", () => {
  beforeEach(() => {
    resetPlayerStore();
    resetRemoteStore();
  });

  it("is referentially stable while nothing it exposes moved", () => {
    playerStore.setState({ currentSong: song(7, 180), position: 90, duration: 180 });
    const first = getPlaybackView();
    expect(getPlaybackView()).toBe(first);
    // A device-local setting the view does not expose must not churn it.
    playerStore.setState({ eqLow: 3 });
    expect(getPlaybackView()).toBe(first);
    playerStore.setState({ position: 91 });
    expect(getPlaybackView()).not.toBe(first);
  });

  it("flips to the mirrored snapshot the moment the role becomes controller", () => {
    playerStore.setState({ currentSong: song(7, 180), position: 90, duration: 180 });
    expect(getPlaybackView().song?.id).toBe(7 as SongId);

    applyRemote({
      yourDeviceId: "s:me",
      activeDeviceId: "s:other",
      snapshot: snapshot(),
      controllerPosition: 30,
      controllerPaused: false,
    });
    const view = getPlaybackView();
    expect(view.passive).toBe(true);
    expect(view.song?.id).toBe(2 as SongId);
    expect(view.position).toBe(30);
    expect(view.duration).toBe(240);

    // Taking playback back locally restores the local read.
    applyRemote({ activeDeviceId: "s:me" });
    expect(getPlaybackView().song?.id).toBe(7 as SongId);
    expect(getPlaybackView().position).toBe(90);
  });
});
