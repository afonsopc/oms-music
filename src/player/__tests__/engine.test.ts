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
    // A second failure within the proving window (PROVEN_AUDIBLE_MS) still
    // marks + advances - the brief resume does not re-arm the recovery.
    ctx.player.emitLoaded(200);
    ctx.player.tick(1);
    ctx.player.emitError("boom again");
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

  it("audible play past the proving window RE-ARMS the in-place recovery", async () => {
    resetPlayerStore();
    setPlaybackInterceptor(null);
    let t = 0;
    const ctx = makeEngineDeps({ now: () => t });
    const engine = new PlayerEngineImpl(ctx.deps);
    const s1 = makeSong(1);
    ctx.resolver.control.urls.set(`compressed-${s1.id}`, `http://cdn/${s1.id}`);
    engine.setQueue([s1]);
    await flush();
    ctx.player.emitLoaded(200);
    ctx.player.tick(1);
    ctx.player.emitError("expired once");
    await flush();
    // Recovered and audibly playing WELL past the proving window (a long
    // repeat-one session between two presigned expiries)...
    ctx.player.emitLoaded(200);
    t += 15_000;
    ctx.player.tick(1);
    const callsBefore = ctx.resolver.control.calls.length;
    // ...so the SECOND expiry gets a fresh in-place recovery, not a skip.
    ctx.player.emitError("expired again");
    await flush();
    expect(ctx.resolver.control.calls.length).toBe(callsBefore + 1);
    expect(playerStore.getState().failedSongKeys.has(toSongKey(1))).toBe(false);
    engine.dispose();
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
    ctx.engine.patchQueueSong(s1.id, { instrumental_media_id: "stem-1" });
    await flush();
    expect(ctx.player.uri?.startsWith("http://cdn/stem1")).toBe(true);
    ctx.player.emitLoaded(200);
    expect(ctx.player.seekLog).toContain(30);
    expect(ctx.player.playing).toBe(true);
    ctx.engine.dispose();
  });

  it("a late status from the OUTGOING source never eats pendingSeek", async () => {
    const ctx = setup();
    const s1 = makeSong(1, { instrumental_media_id: "stem-1" });
    urlFor(ctx, s1);
    ctx.resolver.control.urls.set("stem-1", "http://cdn/stem1");
    ctx.engine.setQueue([s1]);
    await flush();
    ctx.player.emitLoaded(200);
    ctx.player.currentTime = 90;

    // Real delivery order: the pause that precedes the swap reports the OLD
    // item (isLoaded, duration 200) one tick later, while the stem URL is
    // still resolving and the player still holds the original source.
    ctx.player.asyncStatus = true;
    ctx.resolver.control.hold.add("stem-1");
    ctx.engine.setPlaybackMode("instrumental");
    await flush();
    ctx.resolver.control.release("stem-1");
    await flush();
    ctx.player.asyncStatus = false;

    expect(ctx.player.uri?.startsWith("http://cdn/stem1")).toBe(true);
    // replace() reset the clock: only a seek AFTER it restores the position.
    expect(ctx.player.currentTime).toBe(0);
    ctx.player.emitLoaded(200);
    expect(ctx.player.currentTime).toBe(90);
    expect(playerStore.getState().position).toBe(90);
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

describe("queue ops that fill an empty queue", () => {
  beforeEach(() => resetPlayerStore());

  it("addToQueue on an EMPTY queue loads and autoplays the song", async () => {
    const ctx = setup();
    const s1 = makeSong(1);
    urlFor(ctx, s1);
    ctx.engine.addToQueue(s1);
    await flush();
    expect(playerStore.getState().currentSong?.id).toBe(s1.id);
    expect(ctx.player.uri?.startsWith("http://cdn/1")).toBe(true);
    expect(ctx.player.playing).toBe(true);
    ctx.engine.dispose();
  });

  it("addToQueue on a NON-empty queue never restarts the playing track", async () => {
    const ctx = setup();
    const s1 = makeSong(1);
    const s2 = makeSong(2);
    urlFor(ctx, s1);
    urlFor(ctx, s2);
    ctx.engine.setQueue([s1]);
    await flush();
    ctx.player.emitLoaded(200);
    ctx.player.currentTime = 42;
    const replaces = ctx.player.replaceLog.length;
    ctx.engine.addToQueue(s2);
    await flush();
    expect(ctx.player.replaceLog.length).toBe(replaces);
    expect(ctx.player.currentTime).toBe(42);
    expect(playerStore.getState().queue.length).toBe(2);
    ctx.engine.dispose();
  });

  it("playNext and insertJamProposal also start an empty queue", async () => {
    const first = setup();
    const s1 = makeSong(1);
    urlFor(first, s1);
    first.engine.playNext(s1);
    await flush();
    expect(first.player.playing).toBe(true);
    first.engine.dispose();

    resetPlayerStore();
    const second = setup();
    const jam = makeSong(9, { jam_song: true, audio_url: "http://jam/9.mp3" });
    second.engine.insertJamProposal(jam);
    await flush();
    expect(second.player.uri).toBe("http://jam/9.mp3");
    expect(second.player.playing).toBe(true);
    second.engine.dispose();
  });
});

describe("buffering flag (FR-6 spinner honesty)", () => {
  beforeEach(() => resetPlayerStore());

  it("survives statuses from the outgoing source during the resolve", async () => {
    const ctx = setup();
    const s1 = makeSong(1);
    const s2 = makeSong(2);
    urlFor(ctx, s1);
    urlFor(ctx, s2);
    ctx.engine.setQueue([s1, s2]);
    await flush();
    ctx.player.emitLoaded(200);
    expect(playerStore.getState().buffering).toBe(false);

    ctx.resolver.control.hold.add("compressed-2");
    ctx.engine.setQueueIndex(1);
    expect(playerStore.getState().buffering).toBe(true);
    // The paused OUTGOING source keeps reporting isBuffering: false.
    ctx.player.emitStatus();
    ctx.player.emitStatus();
    expect(playerStore.getState().buffering).toBe(true);

    ctx.resolver.control.release("compressed-2");
    await flush();
    ctx.player.emitLoaded(180);
    expect(playerStore.getState().buffering).toBe(false);
    ctx.engine.dispose();
  });

  /**
   * Owner report 2026-08-16, point 2: "picking a song shows metadata and
   * artwork but the bar shows PAUSE when it should show loading". The store
   * drives every play/pause glyph off `playing`, so the only way to draw a
   * spinner is for `buffering` to still be true. It used to clear here,
   * because the source had been handed to the player (loadInFlight false)
   * and a not-yet-loaded native item reports `isBuffering: false`.
   */
  it("stays raised after replace() until the player actually plays", async () => {
    const ctx = setup();
    const song = makeSong(1);
    urlFor(ctx, song);
    ctx.engine.setQueue([song]);
    await flush();

    // replace() has landed and play() was issued, but the item has not
    // started: attached, silent, and NOT reporting isBuffering.
    ctx.player.playing = false;
    ctx.player.loaded = false;
    ctx.player.buffering = false;
    ctx.player.emitStatus();

    expect(playerStore.getState().playing).toBe(false);
    expect(playerStore.getState().buffering).toBe(true);

    // First audible status clears it.
    ctx.player.playing = true;
    ctx.player.emitLoaded(200);
    expect(playerStore.getState().playing).toBe(true);
    expect(playerStore.getState().buffering).toBe(false);
    ctx.engine.dispose();
  });

  it("a paused player is never buffering, however silent it is", async () => {
    const ctx = setup();
    const song = makeSong(1);
    urlFor(ctx, song);
    ctx.engine.setQueue([song]);
    await flush();
    ctx.player.emitLoaded(200);

    ctx.engine.pause();
    ctx.player.buffering = true; // a paused network item still reports this
    ctx.player.emitStatus();

    expect(playerStore.getState().buffering).toBe(false);
    ctx.engine.dispose();
  });
});

describe("logout wipe (FR-10)", () => {
  beforeEach(() => resetPlayerStore());

  it("clears the queue, the source, the store and the lock screen", async () => {
    resetPlayerStore();
    setPlaybackInterceptor(null);
    const lockScreen: (number | null)[] = [];
    const ctx = makeEngineDeps({
      onLockScreenUpdate: (song) => lockScreen.push(song ? (song.id as number) : null),
    });
    const engine = new PlayerEngineImpl(ctx.deps);
    const s1 = makeSong(1);
    ctx.resolver.control.urls.set("compressed-1", "http://cdn/1");
    engine.setQueue([s1]);
    await flush();
    engine.setRate(1.5);
    expect(ctx.player.playing).toBe(true);

    engine.resetForLogout();

    expect(ctx.player.playing).toBe(false);
    expect(ctx.player.uri).toBeNull();
    expect(engine.getQueueState().queue).toEqual([]);
    expect(engine.getCurrentSong()).toBeNull();
    expect(playerStore.getState().queue).toEqual([]);
    expect(playerStore.getState().currentSong).toBeNull();
    expect(playerStore.getState().position).toBe(0);
    expect(lockScreen[lockScreen.length - 1]).toBeNull();
    // Listener settings belong to the device: the persisted rate is restored,
    // not the mid-session 1.5x the previous user set.
    expect(playerStore.getState().rate).toBe(1);
    expect(ctx.player.rate).toBe(1);
    engine.dispose();
  });

  it("lets the next user start a fresh queue afterwards", async () => {
    const ctx = setup();
    const s1 = makeSong(1);
    const s2 = makeSong(2);
    urlFor(ctx, s1);
    urlFor(ctx, s2);
    ctx.engine.setQueue([s1]);
    await flush();
    ctx.engine.resetForLogout();
    ctx.engine.setQueue([s2]);
    await flush();
    expect(ctx.player.uri?.startsWith("http://cdn/2")).toBe(true);
    expect(ctx.player.playing).toBe(true);
    ctx.engine.dispose();
  });
});

// ---------------------------------------------------------------------------
// Stall watchdog (owner report 2026-08-10): "às vezes pára do nada; para dar
// play preciso de dar seek". A wedged native player - loaded, not playing,
// not buffering, while the engine intends play - gets the user's manual fix
// (seek to current position, then play) automatically.
// ---------------------------------------------------------------------------

describe("stall watchdog", () => {
  const wedgedSetup = () => {
    resetPlayerStore();
    setPlaybackInterceptor(null);
    let t = 0;
    const ctx = makeEngineDeps({ now: () => t });
    const engine = new PlayerEngineImpl(ctx.deps);
    return { engine, ...ctx, advance: (ms: number) => (t += ms) };
  };

  it("a play the native player swallows is retried with a seek", async () => {
    const ctx = wedgedSetup();
    const song = makeSong(1);
    urlFor(ctx, song);
    ctx.engine.setQueue([song]);
    await flush();
    ctx.player.emitLoaded(200);
    ctx.player.currentTime = 30;
    ctx.engine.pause();
    ctx.player.emitStatus();

    // The user taps play; the native player accepts and does NOTHING.
    ctx.player.ignorePlay = true;
    ctx.engine.play();
    await flush();
    const seeksBefore = ctx.player.seekLog.length;

    ctx.advance(10_000);
    for (let i = 0; i < 6; i++) ctx.player.emitStatus();
    await flush();

    // The nudge: seek to the current position, then play again.
    expect(ctx.player.seekLog.length).toBeGreaterThan(seeksBefore);
    expect(ctx.player.seekLog.at(-1)).toBe(30);
    expect(ctx.player.playCalls).toBeGreaterThanOrEqual(2);
    ctx.engine.dispose();
  });

  it("needs several consecutive wedged statuses - one blip never nudges", async () => {
    const ctx = wedgedSetup();
    const song = makeSong(1);
    urlFor(ctx, song);
    ctx.engine.setQueue([song]);
    await flush();
    ctx.player.emitLoaded(200);
    ctx.engine.pause();
    ctx.player.emitStatus();

    ctx.player.ignorePlay = true;
    ctx.engine.play();
    await flush();
    const seeksBefore = ctx.player.seekLog.length;

    ctx.advance(10_000);
    for (let i = 0; i < 3; i++) ctx.player.emitStatus();
    await flush();

    expect(ctx.player.seekLog.length).toBe(seeksBefore);
    ctx.engine.dispose();
  });

  it("a buffering stop keeps the intent and recovers once the buffer is dry", async () => {
    const ctx = wedgedSetup();
    const song = makeSong(1);
    urlFor(ctx, song);
    ctx.engine.setQueue([song]);
    await flush();
    ctx.player.emitLoaded(200);
    ctx.player.currentTime = 42;
    ctx.player.emitStatus(); // audible playing

    // Slow network: playback stops WHILE buffering - NOT an interruption.
    ctx.player.playing = false;
    ctx.player.buffering = true;
    ctx.player.emitStatus();

    // The buffer refills but the player stays parked: the watchdog kicks it.
    ctx.player.buffering = false;
    ctx.player.ignorePlay = true;
    ctx.advance(10_000);
    for (let i = 0; i < 6; i++) ctx.player.emitStatus();
    await flush();

    expect(ctx.player.seekLog.at(-1)).toBe(42);
    ctx.engine.dispose();
  });

  it("a REAL interruption (pause with no buffering) is never fought", async () => {
    const ctx = wedgedSetup();
    const song = makeSong(1);
    urlFor(ctx, song);
    ctx.engine.setQueue([song]);
    await flush();
    ctx.player.emitLoaded(200);
    ctx.player.emitStatus(); // audible playing

    // Phone call / lock-screen pause: stops clean, no buffering.
    ctx.player.playing = false;
    ctx.player.emitStatus();
    const seeksBefore = ctx.player.seekLog.length;

    ctx.advance(10_000);
    for (let i = 0; i < 10; i++) ctx.player.emitStatus();
    await flush();

    expect(ctx.player.seekLog.length).toBe(seeksBefore);
    expect(ctx.player.playing).toBe(false);
    ctx.engine.dispose();
  });
});

describe("autoplay blocked (web adapter channel)", () => {
  // The web-only failure mode measured in the spike: media.play() rejects
  // with NotAllowedError, the element never starts, and the adapter raises
  // the dedicated channel instead of a stream error.

  it("clears the intent so the FIRST tap on play plays instead of pausing", async () => {
    const ctx = setup();
    const s1 = makeSong(1);
    urlFor(ctx, s1);
    ctx.player.ignorePlay = true; // play() lands, audio never starts
    ctx.engine.setQueue([s1]); // autoplay intent from the transition
    await flush();
    ctx.player.emitLoaded(200);
    ctx.player.emitAutoplayBlocked();

    expect(playerStore.getState().autoplayBlocked).toBe(true);
    expect(playerStore.getState().playing).toBe(false);
    expect(playerStore.getState().buffering).toBe(false);

    // The inverted-toggle regression: with a stale intendedPlay, toggle()
    // would PAUSE here (audible no-op) and only the second tap would play.
    ctx.player.ignorePlay = false;
    const callsBefore = ctx.player.playCalls;
    ctx.engine.toggle();
    expect(ctx.player.playCalls).toBe(callsBefore + 1);
    expect(ctx.player.playing).toBe(true);
    expect(playerStore.getState().autoplayBlocked).toBe(false);
    ctx.engine.dispose();
  });

  it("never burns recovery or advances the queue (not a stream error)", async () => {
    const ctx = setup();
    const s1 = makeSong(1);
    const s2 = makeSong(2);
    urlFor(ctx, s1);
    urlFor(ctx, s2);
    ctx.player.ignorePlay = true;
    ctx.engine.setQueue([s1, s2]);
    await flush();
    ctx.player.emitLoaded(200);
    const resolvesBefore = ctx.resolver.control.calls.length;
    const replacesBefore = ctx.player.replaceLog.length;
    ctx.player.emitAutoplayBlocked();
    await flush();

    // No fresh-URL reload, no candidate laddering, no mark-and-advance:
    // routed into handlePlayerError this would have burned the single
    // recovery attempt and walked to song 2 in silence.
    expect(ctx.resolver.control.calls.length).toBe(resolvesBefore);
    expect(ctx.player.replaceLog.length).toBe(replacesBefore);
    expect(playerStore.getState().currentSong?.id).toBe(s1.id);
    expect(playerStore.getState().failedSongKeys.size).toBe(0);
    ctx.engine.dispose();
  });

  it("stands the watchdogs down: a blocked player is not a stuck player", async () => {
    // wedgedSetup-style clock so the stall watchdog COULD fire if armed.
    resetPlayerStore();
    setPlaybackInterceptor(null);
    let t = 0;
    const wctx = makeEngineDeps({ now: () => t });
    const engine = new PlayerEngineImpl(wctx.deps);
    const s1 = makeSong(1);
    wctx.resolver.control.urls.set("compressed-1", "http://cdn/1");
    wctx.player.ignorePlay = true;
    engine.setQueue([s1]);
    await flush();
    wctx.player.emitLoaded(200);
    wctx.player.emitAutoplayBlocked();
    const seeksBefore = wctx.player.seekLog.length;

    // Plenty of wedged-looking statuses and wall time: without the cleared
    // intent this is exactly the stall-nudge recipe.
    t += 30_000;
    for (let i = 0; i < 10; i++) wctx.player.emitStatus();
    await flush();

    expect(wctx.player.seekLog.length).toBe(seeksBefore);
    expect(wctx.player.playCalls).toBe(1); // only the original attempt
    engine.dispose();
  });

  it("a user transition with autoplay drops the affordance flag", async () => {
    const ctx = setup();
    const s1 = makeSong(1);
    const s2 = makeSong(2);
    urlFor(ctx, s1);
    urlFor(ctx, s2);
    ctx.player.ignorePlay = true;
    ctx.engine.setQueue([s1, s2]);
    await flush();
    ctx.player.emitLoaded(200);
    ctx.player.emitAutoplayBlocked();
    expect(playerStore.getState().autoplayBlocked).toBe(true);

    // Tapping another song IS a gesture: the affordance must not linger
    // over a track that is about to play normally.
    ctx.player.ignorePlay = false;
    ctx.engine.setQueueIndex(1);
    await flush();
    expect(playerStore.getState().autoplayBlocked).toBe(false);
    ctx.engine.dispose();
  });

  it("becoming a controller drops the affordance with the source", async () => {
    const ctx = setup();
    const s1 = makeSong(1);
    urlFor(ctx, s1);
    ctx.player.ignorePlay = true;
    ctx.engine.setQueue([s1]);
    await flush();
    ctx.player.emitLoaded(200);
    ctx.player.emitAutoplayBlocked();
    expect(playerStore.getState().autoplayBlocked).toBe(true);

    // Audio plays ELSEWHERE now; "toca para ouvir" here would lie.
    ctx.engine.stopAndClearSource();
    expect(playerStore.getState().autoplayBlocked).toBe(false);
    ctx.engine.dispose();
  });
});
