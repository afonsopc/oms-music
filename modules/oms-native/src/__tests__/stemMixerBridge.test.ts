/**
 * The custom-blend bridge, driven by a fake native module (the real one is an
 * AVAudioEngine, which no CI machine has). The rules under test are the ones
 * that decide whether a user ever hears a half mix:
 *
 *  - a remote uri is refused BEFORE it reaches AVAudioFile, which cannot open
 *    one and would fail deep inside ExtAudioFileOpen;
 *  - nothing but prepare() may cross the bridge until both stems are open;
 *  - a native fault is swallowed, because the ORIGINAL file is still playing
 *    (muted) and an exception there would unwind the transport;
 *  - the native `prepared` flag wins over the local one, so a media-services
 *    reset re-arms the guard without anyone in JS asking.
 */
import { describe, expect, it } from "bun:test";
// Type-only (erased at runtime, so the module keeps zero dependencies on app
// code): the point is a COMPILE-TIME proof that the bridge satisfies the seam.
import type { StemMixer } from "@/contracts/stemMixer";
import {
  createStemMixerBridge,
  inertStemMixerBridge,
  isLocalStemUri,
  RemoteStemUriError,
  type NativeStemMixerModule,
  type StemMixerFullStatus,
  type StemMixerSubscription,
} from "../stemMixerBridge";

type Call = [string, ...unknown[]];

class FakeNativeStemMixer implements NativeStemMixerModule {
  readonly calls: Call[] = [];
  throwOn = new Set<string>();
  prepareRejection: Error | null = null;
  status: StemMixerFullStatus = {
    currentTime: 0,
    duration: 0,
    playing: false,
    prepared: false,
    error: null,
  };
  drift = 0;

  private listeners = new Set<(s: StemMixerFullStatus) => void>();

  addListener(
    event: "statusUpdate",
    listener: (status: StemMixerFullStatus) => void,
  ): StemMixerSubscription {
    this.calls.push(["addListener", event]);
    this.listeners.add(listener);
    return {
      remove: () => {
        this.listeners.delete(listener);
      },
    };
  }

  async prepare(vocalsUri: string, instrumentalUri: string, startSeconds: number): Promise<void> {
    this.calls.push(["prepare", vocalsUri, instrumentalUri, startSeconds]);
    if (this.prepareRejection) throw this.prepareRejection;
  }

  play(): void {
    this.record("play");
  }

  pause(): void {
    this.record("pause");
  }

  seek(seconds: number): void {
    this.record("seek", seconds);
  }

  setGains(vocal: number, instrumental: number, master: number): void {
    this.record("setGains", vocal, instrumental, master);
  }

  setEq(low: number, mid: number, high: number, enabled: boolean): void {
    this.record("setEq", low, mid, high, enabled);
  }

  setRate(rate: number): void {
    this.record("setRate", rate);
  }

  getStatus(): StemMixerFullStatus {
    this.record("getStatus");
    return this.status;
  }

  resync(referenceSeconds: number, toleranceSeconds: number): number {
    this.record("resync", referenceSeconds, toleranceSeconds);
    return this.drift;
  }

  release(): void {
    this.record("release");
  }

  emit(status: StemMixerFullStatus): void {
    for (const listener of [...this.listeners]) listener(status);
  }

  listenerCount(): number {
    return this.listeners.size;
  }

  names(): string[] {
    return this.calls.map(([name]) => name);
  }

  private record(name: string, ...args: unknown[]): void {
    this.calls.push([name, ...args]);
    if (this.throwOn.has(name)) throw new Error(`native ${name} exploded`);
  }
}

const LOCAL_VOCALS = "file:///var/app/oms-downloads/u1/song_vocal.mp3";
const LOCAL_INSTRUMENTAL = "file:///var/app/oms-downloads/u1/song_instrumental.mp3";

/** The repo's async-rejection idiom: bun's `.rejects` is not in the typings. */
const rejection = async (run: () => Promise<unknown>): Promise<unknown> => {
  try {
    await run();
  } catch (error) {
    return error;
  }
  return null;
};

const readyBridge = async (): Promise<{
  native: FakeNativeStemMixer;
  bridge: ReturnType<typeof createStemMixerBridge>;
}> => {
  const native = new FakeNativeStemMixer();
  const bridge = createStemMixerBridge(native);
  await bridge.prepare(LOCAL_VOCALS, LOCAL_INSTRUMENTAL);
  native.calls.length = 0;
  return { native, bridge };
};

describe("the seam contract", () => {
  it("assigns to the app's StemMixer with no cast, native or inert", () => {
    const live: StemMixer = createStemMixerBridge(new FakeNativeStemMixer());
    const inert: StemMixer = inertStemMixerBridge;
    expect(live.isAvailable()).toBe(true);
    expect(inert.isAvailable()).toBe(false);
  });
});

describe("isLocalStemUri", () => {
  it("accepts file uris and absolute paths", () => {
    expect(isLocalStemUri(LOCAL_VOCALS)).toBe(true);
    expect(isLocalStemUri("/var/mobile/song_vocal.mp3")).toBe(true);
    expect(isLocalStemUri("  file:///a.mp3  ")).toBe(true);
  });

  it("refuses remote and empty uris", () => {
    expect(isLocalStemUri("https://storage.omelhorsite.pt/a.mp3?sig=x")).toBe(false);
    expect(isLocalStemUri("http://127.0.0.1/a.mp3")).toBe(false);
    expect(isLocalStemUri("content://media/audio/1")).toBe(false);
    expect(isLocalStemUri("")).toBe(false);
    expect(isLocalStemUri("   ")).toBe(false);
  });
});

describe("createStemMixerBridge without a native module", () => {
  it("is the inert bridge and reports itself unavailable", async () => {
    const bridge = createStemMixerBridge(null);
    expect(bridge).toBe(inertStemMixerBridge);
    expect(bridge.isAvailable()).toBe(false);
    expect(bridge.getStatus()).toBeNull();
    expect(bridge.resync(10, 0.1)).toBe(0);
    bridge.play();
    bridge.release();
    const error = await rejection(() => bridge.prepare(LOCAL_VOCALS, LOCAL_INSTRUMENTAL));
    expect((error as Error).message).toBe("Stem mixer unavailable");
  });
});

describe("createStemMixerBridge prepare", () => {
  it("refuses a remote uri before it reaches the native side", async () => {
    const native = new FakeNativeStemMixer();
    const bridge = createStemMixerBridge(native);
    const badVocals = await rejection(() =>
      bridge.prepare("https://storage.omelhorsite.pt/vocals.mp3", LOCAL_INSTRUMENTAL),
    );
    const badInstrumental = await rejection(() =>
      bridge.prepare(LOCAL_VOCALS, "https://storage.omelhorsite.pt/inst.mp3"),
    );
    expect(badVocals).toBeInstanceOf(RemoteStemUriError);
    expect(badInstrumental).toBeInstanceOf(RemoteStemUriError);
    expect(native.names()).toEqual([]);
  });

  it("passes a zero start offset through and arms the transport", async () => {
    const native = new FakeNativeStemMixer();
    const bridge = createStemMixerBridge(native);
    await bridge.prepare(LOCAL_VOCALS, LOCAL_INSTRUMENTAL);
    expect(native.calls[0]).toEqual(["prepare", LOCAL_VOCALS, LOCAL_INSTRUMENTAL, 0]);
    bridge.play();
    expect(native.names()).toContain("play");
  });

  it("prepareAt forwards the start offset and never a negative one", async () => {
    const native = new FakeNativeStemMixer();
    const bridge = createStemMixerBridge(native);
    await bridge.prepareAt(LOCAL_VOCALS, LOCAL_INSTRUMENTAL, 42.5);
    await bridge.prepareAt(LOCAL_VOCALS, LOCAL_INSTRUMENTAL, -3);
    expect(native.calls[0]).toEqual(["prepare", LOCAL_VOCALS, LOCAL_INSTRUMENTAL, 42.5]);
    expect(native.calls[1]).toEqual(["prepare", LOCAL_VOCALS, LOCAL_INSTRUMENTAL, 0]);
  });

  it("leaves the transport disarmed when the native prepare rejects", async () => {
    const native = new FakeNativeStemMixer();
    native.prepareRejection = new Error("Stem file could not be opened");
    const bridge = createStemMixerBridge(native);
    const error = await rejection(() => bridge.prepare(LOCAL_VOCALS, LOCAL_INSTRUMENTAL));
    expect((error as Error).message).toBe("Stem file could not be opened");
    native.calls.length = 0;
    bridge.play();
    bridge.seek(10);
    expect(native.names()).toEqual([]);
  });
});

describe("createStemMixerBridge transport", () => {
  it("drops play / pause / seek until both stems are open", () => {
    const native = new FakeNativeStemMixer();
    const bridge = createStemMixerBridge(native);
    bridge.play();
    bridge.pause();
    bridge.seek(12);
    expect(native.names()).toEqual([]);
  });

  it("forwards transport calls once prepared and clamps a negative seek", async () => {
    const { native, bridge } = await readyBridge();
    bridge.play();
    bridge.seek(-5);
    bridge.pause();
    expect(native.calls).toEqual([["play"], ["seek", 0], ["pause"]]);
  });

  it("release disarms the transport again", async () => {
    const { native, bridge } = await readyBridge();
    bridge.release();
    bridge.play();
    expect(native.calls).toEqual([["release"]]);
  });
});

describe("createStemMixerBridge parameters", () => {
  it("flattens gains and bands onto the native argument lists", async () => {
    const { native, bridge } = await readyBridge();
    bridge.setGains({ vocal: 0.8, instrumental: 0.4, master: 0.6 });
    bridge.setEq({ low: 3, mid: -2, high: 0 }, true);
    bridge.setRate(1.25);
    expect(native.calls).toEqual([
      ["setGains", 0.8, 0.4, 0.6],
      ["setEq", 3, -2, 0, true],
      ["setRate", 1.25],
    ]);
  });

  it("accepts gains and bands before prepare, so entering the blend is silent-free", () => {
    const native = new FakeNativeStemMixer();
    const bridge = createStemMixerBridge(native);
    bridge.setGains({ vocal: 1, instrumental: 0, master: 0.5 });
    bridge.setEq({ low: 0, mid: 0, high: 0 }, false);
    expect(native.names()).toEqual(["setGains", "setEq"]);
  });
});

describe("createStemMixerBridge fault tolerance", () => {
  it("swallows a native throw on every fire-and-forget call", async () => {
    const { native, bridge } = await readyBridge();
    native.throwOn = new Set(["play", "pause", "seek", "setGains", "setEq", "setRate", "release"]);
    expect(() => {
      bridge.play();
      bridge.pause();
      bridge.seek(1);
      bridge.setGains({ vocal: 1, instrumental: 1, master: 1 });
      bridge.setEq({ low: 0, mid: 0, high: 0 }, false);
      bridge.setRate(1);
      bridge.release();
    }).not.toThrow();
    expect(native.names()).toEqual([
      "play",
      "pause",
      "seek",
      "setGains",
      "setEq",
      "setRate",
      "release",
    ]);
  });

  it("reports a null status and zero drift when the native side throws", async () => {
    const { native, bridge } = await readyBridge();
    native.throwOn = new Set(["getStatus", "resync"]);
    expect(bridge.getStatus()).toBeNull();
    expect(bridge.resync(30, 0.05)).toBe(0);
  });
});

describe("createStemMixerBridge status", () => {
  it("narrows the native status to the seam's three fields", async () => {
    const { native, bridge } = await readyBridge();
    const seen: unknown[] = [];
    const unsubscribe = bridge.onStatus((s) => seen.push(s));
    native.emit({ currentTime: 12.5, duration: 200, playing: true, prepared: true, error: null });
    expect(seen).toEqual([{ currentTime: 12.5, playing: true, error: null }]);
    unsubscribe();
    expect(native.listenerCount()).toBe(0);
  });

  it("re-arms the guard from the native prepared flag", async () => {
    const { native, bridge } = await readyBridge();
    bridge.onStatus(() => {});
    native.emit({
      currentTime: 0,
      duration: 0,
      playing: false,
      prepared: false,
      error: "Media services were reset",
    });
    native.calls.length = 0;
    bridge.play();
    expect(native.names()).toEqual([]);
  });

  it("returns the mixer's own clock so JS can measure drift", async () => {
    const { native, bridge } = await readyBridge();
    native.status = {
      currentTime: 61.2,
      duration: 200,
      playing: true,
      prepared: true,
      error: null,
    };
    native.drift = -0.031;
    expect(bridge.getStatus()?.currentTime).toBe(61.2);
    expect(bridge.resync(61.23, 0.05)).toBe(-0.031);
    expect(native.calls.at(-1)).toEqual(["resync", 61.23, 0.05]);
  });
});
