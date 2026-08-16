/**
 * Web adapter semantics (F1, spike 2 verdict): honest playing, derived
 * buffering, the synthetic status pump, edge-triggered didJustFinish, the
 * play() rejection channels and the inert replace(). Everything the spike
 * measured expo-audio's web build getting wrong, asserted here against a
 * fake HTMLAudioElement.
 */
import { describe, expect, it } from "bun:test";
import type { AudioAdapterStatus } from "../types";
import {
  createWebAudioAdapter,
  installAutoplayUnlock,
  type WebMediaElement,
} from "../webAudioAdapter";
import { flush } from "./fakes";

const makeDomError = (name: string, message = name): Error => {
  const e = new Error(message);
  e.name = name;
  return e;
};

type PlayOutcome = "resolve" | "notallowed" | "notsupported" | "abort";

class FakeMedia implements WebMediaElement {
  currentTime = 0;
  duration = NaN;
  paused = true;
  ended = false;
  readyState = 0;
  playbackRate = 1;
  preservesPitch = true;
  volume = 1;
  preload = "";
  error: { code: number; message?: string } | null = null;
  src = "";
  loadCalls = 0;
  playCalls = 0;
  pauseCalls = 0;
  removedAttrs: string[] = [];
  /** How the NEXT play() promise settles (the browser's autoplay verdict). */
  playOutcome: PlayOutcome = "resolve";

  private listeners = new Map<string, Set<() => void>>();

  play(): Promise<void> {
    this.playCalls++;
    switch (this.playOutcome) {
      case "resolve":
        this.paused = false;
        return Promise.resolve();
      case "abort":
        return Promise.reject(makeDomError("AbortError"));
      case "notallowed":
        // The element stays paused: that is precisely why a fire-and-forget
        // isPlaying flag is a ghost.
        return Promise.reject(makeDomError("NotAllowedError"));
      case "notsupported":
        return Promise.reject(makeDomError("NotSupportedError", "source not supported"));
    }
  }

  pause(): void {
    this.pauseCalls++;
    this.paused = true;
  }

  load(): void {
    this.loadCalls++;
    this.readyState = 0;
    this.error = null;
    this.ended = false;
  }

  removeAttribute(name: string): void {
    this.removedAttrs.push(name);
    if (name === "src") this.src = "";
  }

  addEventListener(type: string, cb: () => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(cb);
  }

  removeEventListener(type: string, cb: () => void): void {
    this.listeners.get(type)?.delete(cb);
  }

  fire(type: string): void {
    for (const cb of [...(this.listeners.get(type) ?? [])]) cb();
  }
}

/** Hand-cranked pump: the tests own time, never real intervals. */
const makePump = () => {
  let fn: (() => void) | null = null;
  return {
    schedule: (f: () => void): unknown => {
      fn = f;
      return {};
    },
    cancel: (): void => {
      fn = null;
    },
    tick: (): void => {
      fn?.();
    },
    get active(): boolean {
      return fn !== null;
    },
  };
};

const setup = () => {
  const media = new FakeMedia();
  const pump = makePump();
  const statuses: AudioAdapterStatus[] = [];
  let blocked = 0;
  const adapter = createWebAudioAdapter({
    createMedia: () => media,
    mediaSession: null,
    schedule: pump.schedule,
    cancel: pump.cancel,
  });
  adapter.onStatus((s) => statuses.push(s));
  adapter.onAutoplayBlocked?.(() => blocked++);
  return {
    media,
    pump,
    adapter,
    statuses,
    last: () => statuses.at(-1),
    getBlocked: () => blocked,
  };
};

describe("web adapter: play() rejections", () => {
  it("NotAllowedError goes out the autoplay channel, never status.error", async () => {
    const ctx = setup();
    ctx.adapter.replace("http://cdn/a.mp3");
    ctx.media.playOutcome = "notallowed";
    ctx.adapter.play();
    await flush();
    expect(ctx.getBlocked()).toBe(1);
    // No ghost playing state and no stream error to burn recovery on.
    expect(ctx.adapter.playing).toBe(false);
    expect(ctx.statuses.some((s) => s.error !== null)).toBe(false);
    expect(ctx.last()?.playing).toBe(false);
  });

  it("AbortError (superseded by our own pause/replace) is swallowed", async () => {
    const ctx = setup();
    ctx.adapter.replace("http://cdn/a.mp3");
    ctx.media.playOutcome = "abort";
    ctx.adapter.play();
    await flush();
    expect(ctx.getBlocked()).toBe(0);
    expect(ctx.statuses.some((s) => s.error !== null)).toBe(false);
  });

  it("NotSupportedError reaches status.error exactly once (edge)", async () => {
    const ctx = setup();
    ctx.adapter.replace("http://cdn/a.mp3");
    ctx.media.playOutcome = "notsupported";
    ctx.adapter.play();
    await flush();
    expect(ctx.statuses.filter((s) => s.error !== null).length).toBe(1);
    expect(ctx.last()?.error).toBe("source not supported");
    // The next pump status carries no stale error.
    ctx.pump.tick();
    expect(ctx.last()?.error).toBeNull();
  });

  it("a rejection landing after replace() belongs to a dead world", async () => {
    const ctx = setup();
    ctx.adapter.replace("http://cdn/a.mp3");
    ctx.media.playOutcome = "notallowed";
    ctx.adapter.play();
    // The engine swaps sources before the promise settles.
    ctx.adapter.replace("http://cdn/b.mp3");
    await flush();
    expect(ctx.getBlocked()).toBe(0);
  });
});

describe("web adapter: honest playing + derived buffering", () => {
  it("a blocked play never reads as playing (paused stayed true)", () => {
    const ctx = setup();
    ctx.adapter.replace("http://cdn/a.mp3");
    ctx.media.playOutcome = "notallowed";
    ctx.adapter.play();
    // Even before the rejection settles: the getter reads the element.
    expect(ctx.adapter.playing).toBe(false);
  });

  it("starvation reports isBuffering true IN THE SAME status as the playing flip", () => {
    const ctx = setup();
    ctx.adapter.replace("http://cdn/a.mp3");
    ctx.media.playOutcome = "resolve";
    ctx.adapter.play();
    ctx.media.readyState = 4;
    ctx.pump.tick();
    expect(ctx.last()?.playing).toBe(true);
    expect(ctx.last()?.isBuffering).toBe(false);

    // The network starves: readyState drops while paused stays false. The
    // engine's interruption detector reads playing:false + isBuffering:false
    // as an external pause and clears the play intent (the 2026-08-10
    // silent stop); the SAME status carrying both flags is what makes that
    // impossible here, with no event-ordering luck involved.
    ctx.media.readyState = 2;
    ctx.pump.tick();
    expect(ctx.last()?.playing).toBe(false);
    expect(ctx.last()?.isBuffering).toBe(true);
    expect(ctx.adapter.playing).toBe(false);

    // Bytes return: the element resumes by itself (paused never flipped).
    ctx.media.readyState = 4;
    ctx.media.fire("canplay");
    expect(ctx.last()?.playing).toBe(true);
    expect(ctx.last()?.isBuffering).toBe(false);
  });

  it("a paused element is never 'buffering'", () => {
    const ctx = setup();
    ctx.adapter.replace("http://cdn/a.mp3");
    // Paused load (hydration): wants nothing, buffers nothing.
    ctx.pump.tick();
    expect(ctx.last()?.isBuffering).toBe(false);
    expect(ctx.last()?.playing).toBe(false);
  });
});

describe("web adapter: status pump", () => {
  it("runs while a source is loaded and stops when it is cleared", () => {
    const ctx = setup();
    expect(ctx.pump.active).toBe(false);
    ctx.adapter.replace("http://cdn/a.mp3");
    expect(ctx.pump.active).toBe(true);
    const before = ctx.statuses.length;
    ctx.pump.tick();
    ctx.pump.tick();
    expect(ctx.statuses.length).toBe(before + 2);
    ctx.adapter.replace(null);
    expect(ctx.pump.active).toBe(false);
  });

  it("didJustFinish is an EDGE: once from ended, false on every pump status", () => {
    const ctx = setup();
    ctx.adapter.replace("http://cdn/a.mp3");
    ctx.media.readyState = 4;
    ctx.media.duration = 200;
    ctx.media.currentTime = 200;
    ctx.media.paused = true;
    ctx.media.ended = true; // the LEVEL stays true until the next seek/load
    ctx.media.fire("ended");
    expect(ctx.statuses.filter((s) => s.didJustFinish).length).toBe(1);
    // The pump samples the still-ended element 4x a second; a level-based
    // didJustFinish here would re-run handleEnded forever (double advance).
    ctx.pump.tick();
    ctx.pump.tick();
    expect(ctx.statuses.filter((s) => s.didJustFinish).length).toBe(1);
  });
});

describe("web adapter: inert replace()", () => {
  it("never auto-resumes the new source (the engine decides, not us)", () => {
    const ctx = setup();
    ctx.adapter.replace("http://cdn/a.mp3");
    ctx.media.playOutcome = "resolve";
    ctx.adapter.play();
    ctx.media.readyState = 4;
    expect(ctx.adapter.playing).toBe(true);
    ctx.adapter.replace("http://cdn/b.mp3");
    // expo-audio's web replace() would call play() here because its flag
    // said playing; ours must not - the recovery path reaches replace()
    // without a preceding pause and the engine owns the resume decision.
    expect(ctx.media.playCalls).toBe(1);
    expect(ctx.media.paused).toBe(true);
    expect(ctx.media.src).toBe("http://cdn/b.mp3");
    expect(ctx.adapter.playing).toBe(false);
  });

  it("replace(null) detaches via removeAttribute, not src=''", () => {
    const ctx = setup();
    ctx.adapter.replace("http://cdn/a.mp3");
    ctx.adapter.replace(null);
    // src = "" fires a spurious MEDIA_ERR_SRC_NOT_SUPPORTED error event.
    expect(ctx.media.removedAttrs).toContain("src");
    expect(ctx.adapter.hasSource).toBe(false);
  });
});

describe("web adapter: element errors and seeks", () => {
  it("media error events surface on the status channel", () => {
    const ctx = setup();
    ctx.adapter.replace("http://cdn/a.mp3");
    ctx.media.error = { code: 2 };
    ctx.media.fire("error");
    expect(ctx.last()?.error).toBe("Playback error (code 2)");
  });

  it("seekTo writes the element clock and resolves", async () => {
    const ctx = setup();
    ctx.adapter.replace("http://cdn/a.mp3");
    await ctx.adapter.seekTo(42);
    expect(ctx.media.currentTime).toBe(42);
    // Negative seeks clamp to 0 (previous() restarts at the head).
    await ctx.adapter.seekTo(-5);
    expect(ctx.media.currentTime).toBe(0);
  });

  it("setRate keeps the deliberate pitch shift (FR-64)", () => {
    const ctx = setup();
    ctx.adapter.setRate(1.5);
    expect(ctx.media.playbackRate).toBe(1.5);
    expect(ctx.media.preservesPitch).toBe(false);
  });
});

describe("autoplay unlock (first-gesture silent WAV)", () => {
  const makeDoc = () => {
    const listeners = new Map<string, Set<() => void>>();
    return {
      addEventListener(type: string, cb: () => void): void {
        let set = listeners.get(type);
        if (!set) {
          set = new Set();
          listeners.set(type, set);
        }
        set.add(cb);
      },
      removeEventListener(type: string, cb: () => void): void {
        listeners.get(type)?.delete(cb);
      },
      fire(type: string): void {
        for (const cb of [...(listeners.get(type) ?? [])]) cb();
      },
      count(): number {
        let n = 0;
        for (const set of listeners.values()) n += set.size;
        return n;
      },
    };
  };

  it("plays the scratch element once on the first gesture, then uninstalls", () => {
    const doc = makeDoc();
    let plays = 0;
    installAutoplayUnlock({
      doc,
      createUnlockMedia: () => ({
        play: () => {
          plays++;
          return Promise.resolve();
        },
      }),
    });
    expect(doc.count()).toBeGreaterThan(0);
    doc.fire("pointerdown");
    expect(plays).toBe(1);
    expect(doc.count()).toBe(0);
    // A second gesture finds no listener left.
    doc.fire("pointerdown");
    expect(plays).toBe(1);
  });

  it("a refused unlock never throws into the gesture handler", () => {
    const doc = makeDoc();
    installAutoplayUnlock({
      doc,
      createUnlockMedia: () => ({
        play: () => Promise.reject(makeDomError("NotAllowedError")),
      }),
    });
    expect(() => doc.fire("keydown")).not.toThrow();
  });
});

/**
 * Owner report 2026-08-16, point 7: the volume bar does nothing in Safari on
 * iOS. HTMLMediaElement.volume is read-only there - the assignment is
 * silently ignored - so the adapter finds out by reading the value back,
 * rather than by sniffing a user agent for a behaviour it can observe.
 */
describe("volume support probe", () => {
  it("reports supported while writes stick", () => {
    const { adapter } = setup();
    expect(adapter.supportsVolume?.()).toBe(true);
    adapter.setVolume(0.4);
    expect(adapter.supportsVolume?.()).toBe(true);
  });

  it("latches unsupported the first time a write is ignored", () => {
    const { adapter, media } = setup();
    // The iOS Safari shape: assignable, never changes.
    Object.defineProperty(media, "volume", {
      get: () => 1,
      set: () => {},
      configurable: true,
    });

    adapter.setVolume(0.4);

    expect(adapter.supportsVolume?.()).toBe(false);
  });
});
