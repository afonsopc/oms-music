/**
 * Engine behavior with a FakeAudioPlayer (WP3 acceptance): transition
 * races, pendingSeek, repeat-one on ended, the recovery ladder, patch
 * reconciliation, mode-switch continuity, interceptor consumption.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { setPlaybackInterceptor } from "@/contracts/playbackInterceptor";
import { toSongKey } from "@/domain/ids";
import type { Song } from "@/domain/song";
import { PlayerEngineImpl } from "../engine";
import { setPlayerToastHandler } from "../recovery";
import { playerStore, resetPlayerStore } from "../store";
import { flush, makeEngineDeps, makeSong } from "./fakes";

setPlayerToastHandler(() => {});

const setup = () => {
  resetPlayerStore();
  setPlaybackInterceptor(null);
  const ctx = makeEngineDeps();
  const engine = new PlayerEngineImpl(ctx.deps);
  return { engine, ...ctx };
};

const urlFor = (ctx: ReturnType<typeof setup>, song: Song, node?: string): void => {
  ctx.resolver.control.urls.set(node ?? `compressed-${song.id}`, `http://cdn/${song.id}`);
};

describe("transitions", () => {
  beforeEach(() => resetPlayerStore());

  it("setQueue resolves the compressed node and autoplays", async () => {
    const ctx = setup();
    const s1 = makeSong(1);
    urlFor(ctx, s1);
    ctx.engine.setQueue([s1]);
    await flush();
    expect(ctx.player.uri?.startsWith("http://cdn/1")).toBe(true);
    expect(ctx.player.playing).toBe(true);
    expect(ctx.resolver.control.calls).toEqual(["compressed-1"]);
    ctx.engine.dispose();
  });

  it("a rapid skip never plays the stale track (gen + loading guards)", async () => {
    const ctx = setup();
    const s1 = makeSong(1);
    const s2 = makeSong(2);
    urlFor(ctx, s1);
    urlFor(ctx, s2);
    ctx.resolver.control.hold.add("compressed-1"); // song 1 resolve hangs
    ctx.engine.setQueue([s1, s2]);
    await flush();
    ctx.engine.setQueueIndex(1); // user skips before the resolve lands
    await flush();
    expect(ctx.player.uri?.startsWith("http://cdn/2")).toBe(true);
    ctx.resolver.control.release("compressed-1"); // late answer arrives
    await flush();
    // The late URL for the skipped song must never touch the player.
    expect(ctx.player.uri?.startsWith("http://cdn/2")).toBe(true);
    expect(ctx.player.replaceLog.filter((u) => u?.startsWith("http://cdn/1")).length).toBe(0);
    ctx.engine.dispose();
  });

  it("hydration loads paused and applies pendingSeek when metadata lands", async () => {
    const ctx = setup();
    const s1 = makeSong(1);
    urlFor(ctx, s1);
    ctx.engine.adoptSnapshot(
      { queue: [s1], queueOrder: [0], queueIndex: 0, shuffle: false },
      { position: 42, paused: false, cause: "hydration" }, // hydration forces paused
    );
    await flush();
    expect(ctx.player.uri?.startsWith("http://cdn/1")).toBe(true);
    expect(ctx.player.playing).toBe(false);
    ctx.player.emitLoaded(200);
    expect(ctx.player.seekLog).toContain(42);
    expect(ctx.player.playing).toBe(false);
    ctx.engine.dispose();
  });

  it("activation honors the remote paused flag and seeds the recorder", async () => {
    const ctx = setup();
    const s1 = makeSong(1, { duration: 200 });
    urlFor(ctx, s1);
    ctx.engine.adoptSnapshot(
      { queue: [s1], queueOrder: [0], queueIndex: 0, shuffle: false },
      { position: 100, paused: false, cause: "activation" },
    );
    await flush();
    ctx.player.emitLoaded(200);
    expect(ctx.player.playing).toBe(true);
    expect(ctx.player.seekLog).toContain(100);
    // Transferred-in seed: 40 s of listening records nothing (FR-62).
    for (let t = 100; t < 140; t += 0.25) ctx.player.tick(0.25);
    expect(ctx.recorded).toEqual([]);
    ctx.engine.dispose();
  });

  it("a registered interceptor consumes user transitions (nothing loads)", async () => {
    const ctx = setup();
    const consumed: number[] = [];
    setPlaybackInterceptor((song) => {
      consumed.push(song.id);
      return true;
    });
    const s1 = makeSong(1);
    urlFor(ctx, s1);
    ctx.engine.setQueue([s1]);
    await flush();
    expect(consumed).toEqual([1]);
    expect(ctx.player.uri).toBeNull();
    expect(playerStore.getState().currentSong?.id).toBe(1);
    setPlaybackInterceptor(null);
    ctx.engine.dispose();
  });
});

describe("ended / loop (FR-58)", () => {
  it("repeat-one fires on ended: seek 0 + play, never a native loop flag", async () => {
    const ctx = setup();
    const s1 = makeSong(1);
    urlFor(ctx, s1);
    ctx.engine.setQueue([s1]);
    await flush();
    ctx.player.emitLoaded(200);
    ctx.engine.setLoopMode("one");
    ctx.player.currentTime = 199;
    ctx.player.emitEnded();
    await flush();
    expect(ctx.player.seekLog).toContain(0);
    expect(ctx.player.playing).toBe(true);
    // Same source, no reload: replace was called exactly once.
    expect(ctx.player.replaceLog.length).toBe(1);
    ctx.engine.dispose();
  });

  it("advances under loop all and wraps at the end", async () => {
    const ctx = setup();
    const s1 = makeSong(1);
    const s2 = makeSong(2);
    urlFor(ctx, s1);
    urlFor(ctx, s2);
    ctx.engine.setQueue([s1, s2]);
    await flush();
    ctx.player.emitLoaded(200);
    ctx.player.emitEnded();
    await flush();
    expect(playerStore.getState().queueIndex).toBe(1);
    expect(ctx.player.uri?.startsWith("http://cdn/2")).toBe(true);
    ctx.player.emitLoaded(180);
    ctx.player.emitEnded();
    await flush();
    expect(playerStore.getState().queueIndex).toBe(0); // wrapped
    ctx.engine.dispose();
  });

  it("end-of-song sleep timer pauses and suppresses the next autoplay", async () => {
    const ctx = setup();
    const s1 = makeSong(1);
    const s2 = makeSong(2);
    urlFor(ctx, s1);
    urlFor(ctx, s2);
    ctx.engine.setQueue([s1, s2]);
    await flush();
    ctx.player.emitLoaded(200);
    ctx.engine.setSleepTimer({ endOfSong: true });
    ctx.player.emitEnded();
    await flush();
    expect(playerStore.getState().queueIndex).toBe(1); // advanced...
    expect(ctx.player.playing).toBe(false); // ...but paused
    expect(playerStore.getState().sleepTimer).toBeNull(); // and cleared
    ctx.engine.dispose();
  });
});

describe("recovery ladder (FR-61)", () => {
  it("first stream error re-resolves fresh and restores the position", async () => {
    const ctx = setup();
    const s1 = makeSong(1);
    urlFor(ctx, s1);
    ctx.engine.setQueue([s1]);
    await flush();
    ctx.player.emitLoaded(200);
    ctx.player.tick(1); // audible
    ctx.player.currentTime = 55;
    const callsBefore = ctx.resolver.control.calls.length;
    ctx.player.emitError("presigned URL expired");
    await flush();
    // Fresh resolve: a NEW network call, never the cached URL.
    expect(ctx.resolver.control.calls.length).toBe(callsBefore + 1);
    expect(ctx.player.uri?.startsWith("http://cdn/1")).toBe(true);
    ctx.player.emitLoaded(200);
    expect(ctx.player.seekLog).toContain(55); // position restored
    expect(ctx.player.playing).toBe(true); // resumed
    ctx.engine.dispose();
  });

  it("second failure marks failed and advances; a failed next entry halts", async () => {
    const ctx = setup();
    const s1 = makeSong(1);
    const s2 = makeSong(2);
    urlFor(ctx, s1);
    urlFor(ctx, s2);
    ctx.engine.setQueue([s1, s2]);
    await flush();
    ctx.player.emitLoaded(200);
    ctx.player.tick(1);
    ctx.player.emitError("boom"); // recovery attempt
    await flush();
    ctx.player.emitLoaded(200);
    ctx.player.tick(1);
    ctx.player.emitError("boom again"); // second failure: mark + advance
    await flush();
    expect(playerStore.getState().failedSongKeys.has(toSongKey(1))).toBe(true);
    expect(playerStore.getState().queueIndex).toBe(1);
    expect(ctx.player.uri?.startsWith("http://cdn/2")).toBe(true);
    // Now s2 dies twice too: it would advance back to s1, which already
    // failed - the chain must HALT instead of looping a dead queue.
    ctx.player.emitLoaded(180);
    ctx.player.tick(1);
    ctx.player.emitError("x");
    await flush();
    ctx.player.emitLoaded(180);
    ctx.player.tick(1);
    ctx.player.emitError("y");
    await flush();
    expect(playerStore.getState().failedSongKeys.has(toSongKey(2))).toBe(true);
    expect(playerStore.getState().queueIndex).toBe(1); // halted, no loop
    ctx.engine.dispose();
  });

  it("a song that audibly plays leaves the failed set", async () => {
    const ctx = setup();
    const s1 = makeSong(1);
    const s2 = makeSong(2);
    urlFor(ctx, s1);
    urlFor(ctx, s2);
    ctx.engine.setQueue([s1, s2]);
    await flush();
    ctx.player.emitLoaded(200);
    ctx.player.tick(1);
    ctx.player.emitError("a");
    await flush();
    ctx.player.emitLoaded(200);
    ctx.player.tick(1);
    ctx.player.emitError("b");
    await flush();
    expect(playerStore.getState().failedSongKeys.has(toSongKey(1))).toBe(true);
    // Replay song 1 and let it audibly play: proven good again.
    ctx.engine.setQueueIndex(0);
    await flush();
    ctx.player.emitLoaded(200);
    ctx.player.tick(1);
    expect(playerStore.getState().failedSongKeys.has(toSongKey(1))).toBe(false);
    ctx.engine.dispose();
  });

  it("URL resolve failure (both attempts) marks and advances immediately", async () => {
    const ctx = setup();
    const s1 = makeSong(1); // no URL registered: resolver rejects twice
    const s2 = makeSong(2);
    urlFor(ctx, s2);
    ctx.engine.setQueue([s1, s2]);
    await flush();
    expect(playerStore.getState().failedSongKeys.has(toSongKey(1))).toBe(true);
    expect(playerStore.getState().queueIndex).toBe(1);
    expect(ctx.player.uri?.startsWith("http://cdn/2")).toBe(true);
    ctx.engine.dispose();
  });
});

describe("patch + modes (FR-68)", () => {
  it("patching the playing song never restarts it", async () => {
    const ctx = setup();
    const s1 = makeSong(1);
    urlFor(ctx, s1);
    ctx.engine.setQueue([s1]);
    await flush();
    ctx.player.emitLoaded(200);
    const replaces = ctx.player.replaceLog.length;
    ctx.engine.patchQueueSong(s1.id, { title: "renamed" });
    await flush();
    expect(ctx.player.replaceLog.length).toBe(replaces);
    expect(playerStore.getState().currentSong?.title).toBe("renamed");
    ctx.engine.dispose();
  });

  it("stale-queue reconciliation swaps to the stem file when ids land", async () => {
    const ctx = setup();
    const s1 = makeSong(1);
    urlFor(ctx, s1);
    ctx.resolver.control.urls.set("stem-1", "http://cdn/stem1");
    ctx.engine.setQueue([s1]);
    await flush();
    ctx.player.emitLoaded(200);
    ctx.player.tick(1);
    // Instrumental wanted but no stems yet: keeps playing the plain mix.
    ctx.engine.setPlaybackMode("instrumental");
    await flush();
    expect(ctx.player.uri?.startsWith("http://cdn/1")).toBe(true);
    // Separation finishes; ids land via patch: swap preserving position.
    ctx.player.currentTime = 30;
    ctx.engine.patchQueueSong(s1.id, { instrumental_fs_node_id: "stem-1" });
    await flush();
    expect(ctx.player.uri?.startsWith("http://cdn/stem1")).toBe(true);
    ctx.player.emitLoaded(200);
    expect(ctx.player.seekLog).toContain(30);
    expect(ctx.player.playing).toBe(true);
    ctx.engine.dispose();
  });

  it("mode switch to the same file (original <-> custom) does nothing", async () => {
    const ctx = setup();
    const s1 = makeSong(1);
    urlFor(ctx, s1);
    ctx.engine.setQueue([s1]);
    await flush();
    ctx.player.emitLoaded(200);
    const replaces = ctx.player.replaceLog.length;
    ctx.engine.setPlaybackMode("custom"); // v1: custom plays the plain mix
    await flush();
    expect(ctx.player.replaceLog.length).toBe(replaces);
    expect(playerStore.getState().playbackMode).toBe("custom");
    ctx.engine.dispose();
  });
});

describe("transport odds and ends", () => {
  it("previous restarts past 3 s and steps back near the start", async () => {
    const ctx = setup();
    const s1 = makeSong(1);
    const s2 = makeSong(2);
    urlFor(ctx, s1);
    urlFor(ctx, s2);
    ctx.engine.setQueue([s1, s2], 1);
    await flush();
    ctx.player.emitLoaded(200);
    ctx.player.currentTime = 10;
    ctx.engine.previous();
    expect(ctx.player.seekLog).toContain(0);
    expect(playerStore.getState().queueIndex).toBe(1); // restarted, no step
    ctx.player.currentTime = 1;
    ctx.engine.previous();
    await flush();
    expect(playerStore.getState().queueIndex).toBe(0);
    ctx.engine.dispose();
  });

  it("stopAndClearSource silences; playFromIdle re-resolves and resumes", async () => {
    const ctx = setup();
    const s1 = makeSong(1);
    urlFor(ctx, s1);
    ctx.engine.setQueue([s1]);
    await flush();
    ctx.player.emitLoaded(200);
    ctx.engine.stopAndClearSource();
    expect(ctx.player.uri).toBeNull();
    playerStore.setState({ position: 33 });
    ctx.engine.playFromIdle();
    await flush();
    expect(ctx.player.uri?.startsWith("http://cdn/1")).toBe(true);
    ctx.player.emitLoaded(200);
    expect(ctx.player.seekLog).toContain(33);
    expect(ctx.player.playing).toBe(true);
    ctx.engine.dispose();
  });

  it("volume and rate clamp, persist, and reach the player", async () => {
    const ctx = setup();
    ctx.engine.setVolume(1.7);
    expect(ctx.player.volume).toBe(1);
    ctx.engine.setRate(3); // store keeps the wire value, player is capped
    expect(playerStore.getState().rate).toBe(3);
    expect(ctx.player.rate).toBe(2);
    ctx.engine.setRate(0.5);
    expect(ctx.player.rate).toBe(0.5);
    ctx.engine.dispose();
  });
});
