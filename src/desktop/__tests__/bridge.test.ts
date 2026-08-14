/**
 * The two pure pieces of the desktop bridge: IPC payload parsing (crossed a
 * process boundary, must never throw) and the playback mirror's send
 * discipline (4 Hz store ticks must NOT become 4 Hz IPC).
 */
import { describe, expect, test } from "bun:test";
import {
  PLAYBACK_TICK_MS,
  playbackUpdateReason,
  SEEK_EPSILON_S,
  toRemoteCommand,
  type SentPlayback,
} from "../protocol";

describe("toRemoteCommand", () => {
  test("maps every transport kind 1:1", () => {
    for (const kind of ["play", "pause", "toggle", "next", "previous", "seekForward", "seekBackward"]) {
      expect(toRemoteCommand({ kind })).toEqual({ kind } as never);
    }
  });

  test("seek carries finite seconds", () => {
    expect(toRemoteCommand({ kind: "seek", seconds: 42.5 })).toEqual({ kind: "seek", seconds: 42.5 });
    expect(toRemoteCommand({ kind: "seek", seconds: Number.NaN })).toBeNull();
    expect(toRemoteCommand({ kind: "seek" })).toBeNull();
  });

  test("garbage from the IPC boundary returns null, never throws", () => {
    expect(toRemoteCommand(null)).toBeNull();
    expect(toRemoteCommand("play")).toBeNull();
    expect(toRemoteCommand({ kind: "setVolume" })).toBeNull();
    expect(toRemoteCommand({})).toBeNull();
  });
});

describe("playbackUpdateReason", () => {
  const base: SentPlayback = { songKey: "7", playing: true, position: 10, rate: 1, wallMs: 100_000 };
  const state = (playing: boolean, position: number, rate = 1) => ({ playing, position, rate });

  test("first snapshot and song changes always send", () => {
    expect(playbackUpdateReason(null, "7", state(true, 0), 100_000)).toBe("song");
    expect(playbackUpdateReason(base, "8", state(true, 0), 100_100)).toBe("song");
  });

  test("play/pause flip sends immediately", () => {
    expect(playbackUpdateReason(base, "7", state(false, 10.2), 101_000)).toBe("flip");
  });

  test("position tracking extrapolation stays quiet between ticks", () => {
    // 2s later at rate 1: expected position 12; store says 12.1 - no send.
    expect(playbackUpdateReason(base, "7", state(true, 12.1), 102_000)).toBeNull();
  });

  test("a jump beyond the epsilon is a seek", () => {
    expect(
      playbackUpdateReason(base, "7", state(true, 12 + SEEK_EPSILON_S + 1), 102_000),
    ).toBe("seek");
  });

  test("the slow tick fires only while playing", () => {
    const later = 100_000 + PLAYBACK_TICK_MS;
    expect(playbackUpdateReason(base, "7", state(true, 10 + PLAYBACK_TICK_MS / 1000), later)).toBe("tick");
    const paused: SentPlayback = { ...base, playing: false };
    expect(playbackUpdateReason(paused, "7", state(false, 10), later)).toBeNull();
  });

  test("extrapolation honours the playback rate", () => {
    const fast: SentPlayback = { ...base, rate: 1.5 };
    // 2s later at rate 1.5: expected 13; store at 13.2 - within epsilon.
    expect(playbackUpdateReason(fast, "7", state(true, 13.2, 1.5), 102_000)).toBeNull();
  });
});
