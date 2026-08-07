/**
 * Custom blend orchestration (DESIGN 16.1 amendment 2026-08-03) plus the two
 * separation-state divergences the investigation found:
 *   (a) adoption must preserve the mode it was given;
 *   (b) a stem mode must never publish `separation_enabled: false`.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { setLocalFileIndex } from "@/contracts/localSource";
import {
  setStemFileProvider,
  type StemFileProvider,
  type StemFiles,
} from "@/contracts/stemFiles";
import { setPlaybackInterceptor } from "@/contracts/playbackInterceptor";
import { setStemMixer, type StemMixer, type StemMixerStatus } from "@/contracts/stemMixer";
import type { Song } from "@/domain/song";
import { PlayerEngineImpl } from "../engine";
import { setPlayerToastHandler } from "../recovery";
import { playerStore, resetPlayerStore } from "../store";
import { flush, makeEngineDeps, makeSong } from "./fakes";

setPlayerToastHandler(() => {});

const VOCALS = "file:///stems/1_vocal.mp3";
const INSTRUMENTAL = "file:///stems/1_instrumental.mp3";

/** A song the backend has already separated. */
const separatedSong = (id = 1): Song =>
  makeSong(id, {
    vocals_fs_node_id: `vocals-${id}`,
    instrumental_fs_node_id: `instrumental-${id}`,
  });

interface ProviderControl {
  /** Song keys whose stems are on disk. */
  resident: Set<string>;
  /** Resolvers/rejecters of the in-flight fetch, keyed by song key. */
  pending: Map<
    string,
    {
      resolve: (files: StemFiles) => void;
      reject: (error: Error) => void;
      progress: (fraction: number) => void;
    }
  >;
  fetchCalls: string[];
}

const installProvider = (): ProviderControl => {
  const control: ProviderControl = {
    resident: new Set(),
    pending: new Map(),
    fetchCalls: [],
  };
  const files = (song: Song): StemFiles => ({
    vocalsUri: `file:///stems/${song.id}_vocal.mp3`,
    instrumentalUri: `file:///stems/${song.id}_instrumental.mp3`,
  });
  const provider: StemFileProvider = {
    resident: (song) => (control.resident.has(String(song.id)) ? files(song) : null),
    fetch: (song, onProgress) => {
      control.fetchCalls.push(String(song.id));
      return new Promise<StemFiles>((resolve, reject) => {
        control.pending.set(String(song.id), {
          resolve,
          reject,
          progress: onProgress,
        });
      });
    },
  };
  setStemFileProvider(provider);
  return control;
};

const setup = () => {
  resetPlayerStore();
  setPlaybackInterceptor(null);
  const ctx = makeEngineDeps();
  const engine = new PlayerEngineImpl(ctx.deps);
  return { engine, ...ctx };
};

const urlFor = (ctx: ReturnType<typeof setup>, song: Song): void => {
  ctx.resolver.control.urls.set(`compressed-${song.id}`, `http://cdn/${song.id}`);
};

let provider: ProviderControl;

beforeEach(() => {
  resetPlayerStore();
  provider = installProvider();
});

afterEach(() => {
  setStemFileProvider(null);
  setStemMixer(null);
});

/**
 * A mixer whose only job is to hand the engine a status. The audio-path
 * assertions still read the FakeAudioPlayer: this seam exists so the mixer's
 * FAILURE channel can be driven from a test.
 */
const installMixerStatusChannel = (): ((s: StemMixerStatus) => void) => {
  const listeners = new Set<(s: StemMixerStatus) => void>();
  const noop = (): void => {};
  const mixer: StemMixer = {
    isAvailable: () => true,
    prepare: () => Promise.resolve(),
    play: noop,
    pause: noop,
    seek: noop,
    setGains: noop,
    setEq: noop,
    setRate: noop,
    onStatus: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    release: noop,
  };
  setStemMixer(mixer);
  return (s) => {
    for (const cb of listeners) cb(s);
  };
};

describe("entering and leaving custom mode", () => {
  it("mutes the original and starts the mixer without restarting the main file", async () => {
    const ctx = setup();
    const song = separatedSong();
    urlFor(ctx, song);
    provider.resident.add("1");
    ctx.engine.setQueue([song]);
    await flush();
    ctx.player.emitLoaded(200);
    ctx.player.currentTime = 42;
    const replaces = ctx.player.replaceLog.length;

    ctx.engine.setPlaybackMode("custom");
    await flush();

    // The main player keeps its source, its position and its play state: it
    // is the clock and the lock screen owner, only now it is silent.
    expect(ctx.player.replaceLog.length).toBe(replaces);
    expect(ctx.player.uri?.startsWith("http://cdn/1")).toBe(true);
    expect(ctx.player.currentTime).toBe(42);
    expect(ctx.player.playing).toBe(true);
    expect(ctx.player.volume).toBe(0); // gain law: mainGain = 0
    expect(ctx.player.stemsOn).toBe(true);
    expect(ctx.player.stemPair).toEqual({ vocals: VOCALS, instrumental: INSTRUMENTAL });
    expect(ctx.player.mixerMaster).toBe(1); // masterVolume moved to the mixer
    expect(ctx.player.mixerPlaying).toBe(true);
    // One start pair, aligned to the muted original's clock.
    expect(ctx.player.mixerSeekLog).toContain(42);
    expect(playerStore.getState().stemPhase).toBe("active");
    ctx.engine.dispose();
  });

  it("leaving custom tears the mixer down and restores the main gain", async () => {
    const ctx = setup();
    const song = separatedSong();
    urlFor(ctx, song);
    provider.resident.add("1");
    ctx.engine.setQueue([song]);
    await flush();
    ctx.player.emitLoaded(200);
    ctx.engine.setVolume(0.6);
    ctx.engine.setPlaybackMode("custom");
    await flush();
    expect(ctx.player.volume).toBe(0);
    expect(ctx.player.mixerMaster).toBe(0.6);

    ctx.engine.setPlaybackMode("original");
    await flush();

    expect(ctx.player.stemsOn).toBe(false);
    expect(ctx.player.volume).toBe(0.6); // gain law: mainGain = masterVolume
    expect(playerStore.getState().stemPhase).toBe("off");
    expect(ctx.player.stemLog).toContain("release");
    ctx.engine.dispose();
  });

  it("a track change tears the blend down (stems belong to one song)", async () => {
    const ctx = setup();
    const s1 = separatedSong(1);
    const s2 = makeSong(2);
    urlFor(ctx, s1);
    urlFor(ctx, s2);
    provider.resident.add("1");
    ctx.engine.setQueue([s1, s2]);
    await flush();
    ctx.player.emitLoaded(200);
    ctx.engine.setPlaybackMode("custom");
    await flush();
    expect(ctx.player.stemsOn).toBe(true);

    ctx.engine.next();
    await flush();

    expect(ctx.player.stemsOn).toBe(false);
    expect(playerStore.getState().stemPhase).toBe("off");
    ctx.engine.dispose();
  });

  it("stops at the plain mix when this build has no mixer", async () => {
    const ctx = setup();
    const song = separatedSong();
    urlFor(ctx, song);
    provider.resident.add("1");
    ctx.player.stemMixerAvailable = false;
    ctx.engine.setQueue([song]);
    await flush();
    ctx.player.emitLoaded(200);

    ctx.engine.setPlaybackMode("custom");
    await flush();

    expect(ctx.player.stemsOn).toBe(false);
    expect(ctx.player.volume).toBe(1); // the mix stays audible
    expect(playerStore.getState().stemPhase).toBe("unsupported");
    // The wire value still round-trips untouched (DESIGN 15.6).
    expect(playerStore.getState().playbackMode).toBe("custom");
    ctx.engine.dispose();
  });

  it("never blends a song with only one stem", async () => {
    const ctx = setup();
    const song = makeSong(1, { vocals_fs_node_id: "vocals-1" });
    urlFor(ctx, song);
    provider.resident.add("1");
    ctx.engine.setQueue([song]);
    await flush();
    ctx.player.emitLoaded(200);

    ctx.engine.setPlaybackMode("custom");
    await flush();

    expect(ctx.player.stemsOn).toBe(false);
    expect(provider.fetchCalls).toEqual([]);
    expect(playerStore.getState().stemPhase).toBe("off");
    ctx.engine.dispose();
  });
});

describe("stems must be on disk first", () => {
  it("keeps the plain mix audible while both stems download", async () => {
    const ctx = setup();
    const song = separatedSong();
    urlFor(ctx, song);
    ctx.engine.setQueue([song]);
    await flush();
    ctx.player.emitLoaded(200);

    ctx.engine.setPlaybackMode("custom");
    await flush();

    expect(provider.fetchCalls).toEqual(["1"]);
    expect(ctx.player.stemsOn).toBe(false);
    expect(ctx.player.volume).toBe(1); // NOT muted: no silent half mix
    expect(ctx.player.playing).toBe(true);
    expect(playerStore.getState().stemPhase).toBe("fetching");

    provider.pending.get("1")!.progress(0.5);
    expect(playerStore.getState().stemProgress).toBe(0.5);

    provider.pending.get("1")!.resolve({
      vocalsUri: VOCALS,
      instrumentalUri: INSTRUMENTAL,
    });
    await flush();

    expect(ctx.player.stemsOn).toBe(true);
    expect(ctx.player.volume).toBe(0);
    expect(playerStore.getState().stemPhase).toBe("active");
    ctx.engine.dispose();
  });

  it("falls back to the plain mix when the download fails", async () => {
    const ctx = setup();
    const song = separatedSong();
    urlFor(ctx, song);
    ctx.engine.setQueue([song]);
    await flush();
    ctx.player.emitLoaded(200);
    ctx.engine.setPlaybackMode("custom");
    await flush();

    provider.pending.get("1")!.reject(new Error("no wifi"));
    await flush();

    expect(ctx.player.stemsOn).toBe(false);
    expect(ctx.player.volume).toBe(1);
    expect(ctx.player.playing).toBe(true);
    expect(playerStore.getState().stemPhase).toBe("failed");
    ctx.engine.dispose();
  });

  it("retryStemBlend re-runs a failed provisioning without a track change", async () => {
    const ctx = setup();
    const song = separatedSong();
    urlFor(ctx, song);
    ctx.engine.setQueue([song]);
    await flush();
    ctx.player.emitLoaded(200);
    ctx.engine.setPlaybackMode("custom");
    await flush();
    provider.pending.get("1")!.reject(new Error("no wifi"));
    await flush();
    expect(playerStore.getState().stemPhase).toBe("failed");

    provider.resident.add("1"); // the user got back on WiFi and downloaded
    ctx.engine.retryStemBlend();
    await flush();

    expect(ctx.player.stemsOn).toBe(true);
    expect(playerStore.getState().stemPhase).toBe("active");
    ctx.engine.dispose();
  });

  it("a download that lands after the user left custom never engages", async () => {
    const ctx = setup();
    const song = separatedSong();
    urlFor(ctx, song);
    ctx.engine.setQueue([song]);
    await flush();
    ctx.player.emitLoaded(200);
    ctx.engine.setPlaybackMode("custom");
    await flush();
    ctx.engine.setPlaybackMode("original");
    await flush();

    provider.pending.get("1")!.resolve({
      vocalsUri: VOCALS,
      instrumentalUri: INSTRUMENTAL,
    });
    await flush();

    expect(ctx.player.stemsOn).toBe(false);
    expect(playerStore.getState().stemPhase).toBe("off");
    ctx.engine.dispose();
  });

  it("a mixer prepare that lands after a skip is undone, not left running", async () => {
    const ctx = setup();
    const s1 = separatedSong(1);
    const s2 = makeSong(2);
    urlFor(ctx, s1);
    urlFor(ctx, s2);
    provider.resident.add("1");
    ctx.engine.setQueue([s1, s2]);
    await flush();
    ctx.player.emitLoaded(200);

    ctx.player.stemPrepareGate = []; // hold the native prepare open
    ctx.engine.setPlaybackMode("custom");
    await flush();
    ctx.engine.next(); // user skips while the mixer is still preparing
    await flush();
    ctx.player.releasePrepareGate();
    await flush();

    expect(ctx.player.stemsOn).toBe(false);
    ctx.engine.dispose();
  });

  it("engages when separation finishes on the playing song", async () => {
    const ctx = setup();
    const song = makeSong(1);
    urlFor(ctx, song);
    provider.resident.add("1");
    ctx.engine.setQueue([song]);
    await flush();
    ctx.player.emitLoaded(200);
    ctx.engine.setPlaybackMode("custom");
    await flush();
    expect(ctx.player.stemsOn).toBe(false); // no stems yet

    ctx.engine.patchQueueSong(song.id, {
      vocals_fs_node_id: "vocals-1",
      instrumental_fs_node_id: "instrumental-1",
    });
    await flush();

    expect(ctx.player.stemsOn).toBe(true);
    expect(playerStore.getState().stemPhase).toBe("active");
    ctx.engine.dispose();
  });

  it("stems deleted while a STEM MODE plays swap back to the plain mix", async () => {
    const ctx = setup();
    const song = separatedSong();
    ctx.resolver.control.urls.set("vocals-1", "http://cdn/vocals-1");
    urlFor(ctx, song);
    ctx.engine.setQueue([song]);
    await flush();
    ctx.player.emitLoaded(200);
    ctx.engine.setPlaybackMode("vocals");
    await flush();
    expect(ctx.player.uri?.startsWith("http://cdn/vocals-1")).toBe(true);

    // The cog's "Remove separated tracks" is one tap from the mode chips, and
    // the backend destroys the fs nodes: staying on that stream plays a file
    // that no longer exists.
    ctx.engine.patchQueueSong(song.id, {
      vocals_fs_node_id: null,
      instrumental_fs_node_id: null,
    });
    await flush();

    expect(ctx.player.uri?.startsWith("http://cdn/1")).toBe(true);
    expect(ctx.player.playing).toBe(true);
    ctx.engine.dispose();
  });

  it("stems deleted mid-blend fall back to the plain mix", async () => {
    const ctx = setup();
    const song = separatedSong();
    urlFor(ctx, song);
    provider.resident.add("1");
    ctx.engine.setQueue([song]);
    await flush();
    ctx.player.emitLoaded(200);
    ctx.engine.setPlaybackMode("custom");
    await flush();
    expect(ctx.player.stemsOn).toBe(true);

    ctx.engine.patchQueueSong(song.id, {
      vocals_fs_node_id: null,
      instrumental_fs_node_id: null,
    });
    await flush();

    expect(ctx.player.stemsOn).toBe(false);
    expect(ctx.player.volume).toBe(1);
    expect(playerStore.getState().stemPhase).toBe("off");
    ctx.engine.dispose();
  });
});

describe("a mixer that gives up mid-track", () => {
  it("hands the audio back to the plain mix instead of leaving silence", async () => {
    const emitMixerStatus = installMixerStatusChannel();
    const ctx = setup(); // subscribes to the mixer in its constructor
    const song = separatedSong();
    urlFor(ctx, song);
    provider.resident.add("1");
    ctx.engine.setQueue([song]);
    await flush();
    ctx.player.emitLoaded(200);
    ctx.engine.setPlaybackMode("custom");
    await flush();
    expect(ctx.player.stemsOn).toBe(true);
    expect(ctx.player.volume).toBe(0);

    // Media services reset, a dead AudioTrack, an engine that will not start.
    emitMixerStatus({ currentTime: 12, playing: false, error: "Media services were reset" });

    expect(ctx.player.stemsOn).toBe(false);
    expect(ctx.player.volume).toBe(1); // gain law: mainGain = masterVolume
    expect(ctx.player.playing).toBe(true); // the clock never stopped
    // Retry, not a silent downgrade.
    expect(playerStore.getState().stemPhase).toBe("failed");
    ctx.engine.dispose();
  });

  it("ignores a healthy status and a failure with no blend engaged", async () => {
    const emitMixerStatus = installMixerStatusChannel();
    const ctx = setup();
    const song = separatedSong();
    urlFor(ctx, song);
    provider.resident.add("1");
    ctx.engine.setQueue([song]);
    await flush();
    ctx.player.emitLoaded(200);

    // No blend engaged yet: a stale failure must not mark anything failed.
    emitMixerStatus({ currentTime: 0, playing: false, error: "stale" });
    expect(playerStore.getState().stemPhase).toBe("off");

    ctx.engine.setPlaybackMode("custom");
    await flush();
    emitMixerStatus({ currentTime: 3, playing: true, error: null });

    expect(ctx.player.stemsOn).toBe(true);
    expect(playerStore.getState().stemPhase).toBe("active");
    ctx.engine.dispose();
  });
});

describe("blend and EQ setters reach the audio path", () => {
  it("stem volumes are live writes and persist device-locally", async () => {
    const ctx = setup();
    const song = separatedSong();
    urlFor(ctx, song);
    provider.resident.add("1");
    ctx.engine.setQueue([song]);
    await flush();
    ctx.player.emitLoaded(200);
    ctx.engine.setPlaybackMode("custom");
    await flush();
    const prepares = ctx.player.stemLog.filter((l) => l.startsWith("prepare")).length;

    ctx.engine.setVocalVolume(0.25);
    ctx.engine.setInstrumentalVolume(1.4); // clamps to 1

    expect(ctx.player.stemGains).toEqual({ vocal: 0.25, instrumental: 1 });
    expect(playerStore.getState().vocalVolume).toBe(0.25);
    expect(playerStore.getState().instrumentalVolume).toBe(1);
    // Live parameter writes never restart the blend.
    expect(ctx.player.stemLog.filter((l) => l.startsWith("prepare")).length).toBe(prepares);
    const savedKeys = new Set(ctx.saved.flatMap((patch) => Object.keys(patch)));
    expect(savedKeys.has("vocalVolume")).toBe(true);
    expect(savedKeys.has("instrumentalVolume")).toBe(true);
    ctx.engine.dispose();
  });

  it("EQ bands clamp to -12..+12, persist, and eqEnabled stays session-only", async () => {
    const ctx = setup();
    ctx.engine.setEqBand("low", 30);
    ctx.engine.setEqBand("mid", -30);
    ctx.engine.setEqBand("high", 4.5);
    ctx.engine.setEqEnabled(true);

    expect(ctx.player.eqBands).toEqual({ low: 12, mid: -12, high: 4.5 });
    expect(ctx.player.eqEnabled).toBe(true);
    expect(playerStore.getState().eqLow).toBe(12);
    expect(playerStore.getState().eqMid).toBe(-12);
    expect(playerStore.getState().eqHigh).toBe(4.5);

    const savedKeys = new Set(ctx.saved.flatMap((patch) => Object.keys(patch)));
    expect(savedKeys.has("eqLow")).toBe(true);
    expect(savedKeys.has("eqMid")).toBe(true);
    expect(savedKeys.has("eqHigh")).toBe(true);
    // eqEnabled is deliberately NOT persisted (iOS background default).
    expect(savedKeys.has("eqEnabled")).toBe(false);
    ctx.engine.dispose();
  });

  it("the blend picks up gains and EQ set BEFORE it started", async () => {
    const ctx = setup();
    const song = separatedSong();
    urlFor(ctx, song);
    provider.resident.add("1");
    ctx.engine.setVocalVolume(0.1);
    ctx.engine.setEqBand("high", 6);
    ctx.engine.setEqEnabled(true);
    ctx.engine.setQueue([song]);
    await flush();
    ctx.player.emitLoaded(200);

    ctx.engine.setPlaybackMode("custom");
    await flush();

    expect(ctx.player.stemGains.vocal).toBe(0.1);
    expect(ctx.player.eqBands.high).toBe(6);
    expect(ctx.player.eqEnabled).toBe(true);
    ctx.engine.dispose();
  });
});

describe("separation state: adoption preserves what it was given", () => {
  it("the RAW setter never rewrites the mode", () => {
    const ctx = setup();
    // Exactly the adoption order: mode first, separation flag second.
    ctx.engine.setPlaybackMode("custom");
    ctx.engine.setSeparationEnabled(false);

    expect(playerStore.getState().playbackMode).toBe("custom");
    expect(playerStore.getState().separationEnabled).toBe(false);
    ctx.engine.dispose();
  });

  it("an adopted vocals + separation:false pair survives intact", () => {
    const ctx = setup();
    ctx.engine.setPlaybackMode("vocals");
    ctx.engine.setSeparationEnabled(false);

    expect(playerStore.getState().playbackMode).toBe("vocals");
    expect(playerStore.getState().separationEnabled).toBe(false);
    ctx.engine.dispose();
  });

  it("the USER action still forces the mode back to original", () => {
    const ctx = setup();
    ctx.engine.setPlaybackMode("custom");
    expect(playerStore.getState().playbackMode).toBe("custom");

    ctx.engine.setSeparationEnabledUserAction(false);

    expect(playerStore.getState().playbackMode).toBe("original");
    expect(playerStore.getState().separationEnabled).toBe(false);
    ctx.engine.dispose();
  });

  it("the user action turning it ON leaves the mode alone", () => {
    const ctx = setup();
    ctx.engine.setSeparationEnabledUserAction(true);
    expect(playerStore.getState().separationEnabled).toBe(true);
    expect(playerStore.getState().playbackMode).toBe("original");
    ctx.engine.dispose();
  });
});

describe("separation state: no self-contradictory publish", () => {
  it("choosing a stem mode implies separation is enabled", () => {
    const ctx = setup();
    expect(playerStore.getState().separationEnabled).toBe(false);

    ctx.engine.setPlaybackMode("instrumental");

    expect(playerStore.getState().separationEnabled).toBe(true);
    const savedKeys = new Set(ctx.saved.flatMap((patch) => Object.keys(patch)));
    expect(savedKeys.has("separationEnabled")).toBe(true);
    ctx.engine.dispose();
  });

  it("a device that boots into a stem mode never reports separation off", () => {
    resetPlayerStore();
    const ctx = makeEngineDeps();
    ctx.deps.persistence.load = () => ({
      rate: 1,
      volume: 1,
      separationEnabled: false, // stale pair from an older install
      playbackMode: "instrumental",
      vocalVolume: 1,
      instrumentalVolume: 1,
      eqLow: 0,
      eqMid: 0,
      eqHigh: 0,
      loopMode: "all",
    });
    const engine = new PlayerEngineImpl(ctx.deps);

    expect(playerStore.getState().playbackMode).toBe("instrumental");
    expect(playerStore.getState().separationEnabled).toBe(true);
    engine.dispose();
  });
});

// ---------------------------------------------------------------------------
// EQ passthrough (gainLaw.PASSTHROUGH_GAIN): outside custom mode an enabled
// EQ routes the LOCAL main file through the mixer on both nodes, so the EQ
// colours any downloaded song - no stems, no mode hop.
// ---------------------------------------------------------------------------

describe("EQ passthrough", () => {
  const LOCAL_1 = "file:///downloads/1_mixed.mp3";
  const LOCAL_2 = "file:///downloads/2_mixed.mp3";

  const installLocalMains = (ids: number[]): void => {
    const uris = new Map(ids.map((id) => [String(id), `file:///downloads/${id}_mixed.mp3`]));
    setLocalFileIndex({
      get: (songKey, kind) => (kind === "mixed" ? (uris.get(String(songKey)) ?? null) : null),
      getArtworkByNodeId: () => null,
    });
  };

  afterEach(() => {
    setLocalFileIndex({ get: () => null, getArtworkByNodeId: () => null });
  });

  it("enabling the EQ blends the local main into itself at passthrough gains", async () => {
    installLocalMains([1]);
    const ctx = setup();
    ctx.engine.setQueue([makeSong(1)]);
    await flush();
    ctx.player.emitLoaded(200);

    ctx.engine.setEqEnabled(true);
    await flush();

    expect(ctx.player.stemsOn).toBe(true);
    expect(ctx.player.stemPassthrough).toBe(true);
    expect(ctx.player.stemPair).toEqual({ vocals: LOCAL_1, instrumental: LOCAL_1 });
    expect(ctx.player.volume).toBe(0); // the main player is the muted clock
    // Invisible to the custom-blend UI; only eqActive reports it.
    expect(playerStore.getState().stemPhase).toBe("off");
    expect(playerStore.getState().eqActive).toBe(true);
    expect(playerStore.getState().playbackMode).toBe("original");
    ctx.engine.dispose();
  });

  it("a streamed song stays inert and eqActive says so", async () => {
    const ctx = setup();
    const song = makeSong(1);
    urlFor(ctx, song);
    ctx.engine.setQueue([song]);
    await flush();
    ctx.player.emitLoaded(200);

    ctx.engine.setEqEnabled(true);
    await flush();

    expect(ctx.player.stemsOn).toBe(false);
    expect(playerStore.getState().eqActive).toBe(false);
    ctx.engine.dispose();
  });

  it("a streaming main with a resident local copy blends the COPY (play cache shape)", async () => {
    const ctx = setup();
    const song = makeSong(1);
    urlFor(ctx, song);
    ctx.engine.setQueue([song]);
    await flush();
    ctx.player.emitLoaded(200);
    expect(ctx.player.uri?.startsWith("http://cdn/1")).toBe(true);

    // The cache landed AFTER the stream started: the index knows the file.
    installLocalMains([1]);
    ctx.engine.setEqEnabled(true);
    await flush();

    // The stream stays loaded as the muted clock; the mixer eats the copy.
    expect(ctx.player.uri?.startsWith("http://cdn/1")).toBe(true);
    expect(ctx.player.stemsOn).toBe(true);
    expect(ctx.player.stemPassthrough).toBe(true);
    expect(ctx.player.stemPair).toEqual({ vocals: LOCAL_1, instrumental: LOCAL_1 });
    expect(playerStore.getState().eqActive).toBe(true);
    ctx.engine.dispose();
  });

  it("disabling the EQ releases the passthrough and restores the main gain", async () => {
    installLocalMains([1]);
    const ctx = setup();
    ctx.engine.setQueue([makeSong(1)]);
    await flush();
    ctx.player.emitLoaded(200);
    ctx.engine.setEqEnabled(true);
    await flush();
    expect(ctx.player.stemsOn).toBe(true);

    ctx.engine.setEqEnabled(false);
    await flush();

    expect(ctx.player.stemsOn).toBe(false);
    expect(ctx.player.volume).toBe(1); // mainGain = device volume again
    expect(playerStore.getState().eqActive).toBe(false);
    ctx.engine.dispose();
  });

  it("custom mode outranks the passthrough: real stems, not the degenerate pair", async () => {
    installLocalMains([1]);
    provider.resident.add("1");
    const ctx = setup();
    ctx.engine.setQueue([separatedSong(1)]);
    await flush();
    ctx.player.emitLoaded(200);
    ctx.engine.setEqEnabled(true);
    await flush();
    expect(ctx.player.stemPassthrough).toBe(true);

    ctx.engine.setPlaybackMode("custom");
    await flush();

    expect(ctx.player.stemsOn).toBe(true);
    expect(ctx.player.stemPassthrough).toBe(false);
    expect(ctx.player.stemPair).toEqual({ vocals: VOCALS, instrumental: INSTRUMENTAL });
    expect(playerStore.getState().stemPhase).toBe("active");
    expect(playerStore.getState().eqActive).toBe(true);
    ctx.engine.dispose();
  });

  it("a track change re-arms the passthrough on the next local song", async () => {
    installLocalMains([1, 2]);
    const ctx = setup();
    ctx.engine.setQueue([makeSong(1), makeSong(2)]);
    await flush();
    ctx.player.emitLoaded(200);
    ctx.engine.setEqEnabled(true);
    await flush();
    expect(ctx.player.stemPair?.vocals).toBe(LOCAL_1);

    ctx.engine.next();
    await flush();

    expect(ctx.player.stemsOn).toBe(true);
    expect(ctx.player.stemPassthrough).toBe(true);
    expect(ctx.player.stemPair).toEqual({ vocals: LOCAL_2, instrumental: LOCAL_2 });
    expect(playerStore.getState().eqActive).toBe(true);
    ctx.engine.dispose();
  });

  it("an unopenable file fails SILENTLY - no stem error in original mode", async () => {
    installLocalMains([1]);
    const ctx = setup();
    ctx.engine.setQueue([makeSong(1)]);
    await flush();
    ctx.player.emitLoaded(200);

    ctx.player.stemPrepareError = "unreadable";
    ctx.engine.setEqEnabled(true);
    await flush();

    expect(ctx.player.stemsOn).toBe(false);
    expect(playerStore.getState().stemPhase).toBe("off");
    expect(playerStore.getState().eqActive).toBe(false);
    ctx.engine.dispose();
  });
});
