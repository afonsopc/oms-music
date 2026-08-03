/**
 * Pure JS half of the custom-blend stem mixer (FR-69 / FR-70, DESIGN 16.A).
 *
 * Deliberately import-free so it loads under bun in CI (anything that reaches
 * expo-modules-core drags react-native in and cannot be unit tested here). The
 * native accessor lives next door in OmsStemMixer.ts, exactly as
 * remoteTrackCommands.ts / OmsNative.ts are split.
 *
 * The shapes below are structurally identical to `src/contracts/stemMixer.ts`
 * on purpose: a `StemMixerBridge` satisfies the app's `StemMixer` interface
 * without this module ever importing app code, so the dependency arrow keeps
 * pointing app -> module (the same way `downloads/paths.ts` imports
 * `excludeFromBackup` and never the reverse).
 *
 * Two invariants this layer enforces before anything crosses the bridge:
 *
 *  - iOS `AVAudioFile` is LOCAL-FILE-ONLY, so a remote uri is rejected here
 *    with a clear error instead of failing somewhere inside ExtAudioFileOpen;
 *  - every fire-and-forget call is swallowed on failure. While the blend
 *    plays, the ORIGINAL file is still loaded in expo-audio (muted, as the
 *    clock and the lock-screen owner), so a mixer fault must degrade to a
 *    silent blend the caller can detect and undo - never to a thrown error
 *    that unwinds the transport.
 */

export interface StemMixerEqBands {
  low: number;
  mid: number;
  high: number;
}

/** Matches `StemMixerGains`: per-stem gains plus the mixer's output gain. */
export interface StemMixerGainSet {
  vocal: number;
  instrumental: number;
  master: number;
}

/** Matches `StemMixerStatus`, the slice the app's seam subscribes to. */
export interface StemMixerLiveStatus {
  currentTime: number;
  playing: boolean;
  error: string | null;
}

/** Everything the native module reports, including its own duration view. */
export interface StemMixerFullStatus extends StemMixerLiveStatus {
  duration: number;
  prepared: boolean;
}

export interface StemMixerSubscription {
  remove(): void;
}

/** The native surface, narrowed to what the bridge calls. */
export interface NativeStemMixerModule {
  addListener(
    event: "statusUpdate",
    listener: (status: StemMixerFullStatus) => void,
  ): StemMixerSubscription;
  prepare(vocalsUri: string, instrumentalUri: string, startSeconds: number): Promise<void>;
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  setGains(vocal: number, instrumental: number, master: number): void;
  setEq(low: number, mid: number, high: number, enabled: boolean): void;
  setRate(rate: number): void;
  getStatus(): StemMixerFullStatus;
  /** Returns the measured (mixer - reference) drift in seconds. */
  resync(referenceSeconds: number, toleranceSeconds: number): number;
  release(): void;
}

/**
 * A superset of the app's `StemMixer`: the contract's ten members plus the
 * three the drift watchdog needs. Assign it to a `StemMixer` and the extras
 * simply go unused.
 */
export interface StemMixerBridge {
  isAvailable(): boolean;
  prepare(vocalsUri: string, instrumentalUri: string): Promise<void>;
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  setGains(gains: StemMixerGainSet): void;
  setEq(bands: StemMixerEqBands, enabled: boolean): void;
  setRate(rate: number): void;
  onStatus(cb: (s: StemMixerLiveStatus) => void): () => void;
  release(): void;

  // ----- beyond the contract ------------------------------------------------

  /** Load both stems and pre-roll the schedule at `startSeconds`. */
  prepareAt(vocalsUri: string, instrumentalUri: string, startSeconds: number): Promise<void>;
  /** Synchronous read of the mixer's own clock; null when unavailable. */
  getStatus(): StemMixerFullStatus | null;
  /**
   * Drift safety. Hands the muted reference player's position to the mixer;
   * the mixer re-pairs both stems onto it when they have wandered further
   * than `toleranceSeconds`, and returns the measured drift either way.
   */
  resync(referenceSeconds: number, toleranceSeconds: number): number;
}

/** Native mixers open files, not sockets: only a path or a file:// uri works. */
export const isLocalStemUri = (uri: string): boolean => {
  const trimmed = uri.trim();
  if (trimmed.length === 0) return false;
  return trimmed.startsWith("file://") || trimmed.startsWith("/");
};

export class RemoteStemUriError extends Error {
  constructor(uri: string) {
    super(`Stem uri is not a local file: ${uri}`);
    this.name = "RemoteStemUriError";
  }
}

const noop = (): void => {};

/** Reported by every build with no native mixer: Expo Go, web, old binaries. */
export const inertStemMixerBridge: StemMixerBridge = {
  isAvailable: () => false,
  prepare: () => Promise.reject(new Error("Stem mixer unavailable")),
  prepareAt: () => Promise.reject(new Error("Stem mixer unavailable")),
  play: noop,
  pause: noop,
  seek: noop,
  setGains: noop,
  setEq: noop,
  setRate: noop,
  onStatus: () => noop,
  release: noop,
  getStatus: () => null,
  resync: () => 0,
};

export const createStemMixerBridge = (native: NativeStemMixerModule | null): StemMixerBridge => {
  if (!native) return inertStemMixerBridge;
  const mixer = native;

  // Mirrors the native `prepared` flag so a stray play/seek never crosses the
  // bridge before both stems are open. The native side guards too; this just
  // keeps the common case off the JSI hop.
  let prepared = false;

  /** A mixer fault must never unwind the transport: the mix is still playing. */
  const guarded = (run: () => void): void => {
    try {
      run();
    } catch {
      // Swallowed on purpose - see the file header.
    }
  };

  const prepareAt = async (
    vocalsUri: string,
    instrumentalUri: string,
    startSeconds: number,
  ): Promise<void> => {
    if (!isLocalStemUri(vocalsUri)) throw new RemoteStemUriError(vocalsUri);
    if (!isLocalStemUri(instrumentalUri)) throw new RemoteStemUriError(instrumentalUri);
    prepared = false;
    await mixer.prepare(vocalsUri, instrumentalUri, Math.max(0, startSeconds));
    prepared = true;
  };

  return {
    isAvailable: () => true,
    prepare: (vocalsUri, instrumentalUri) => prepareAt(vocalsUri, instrumentalUri, 0),
    prepareAt,
    play: () => {
      if (!prepared) return;
      guarded(() => mixer.play());
    },
    pause: () => {
      if (!prepared) return;
      guarded(() => mixer.pause());
    },
    seek: (seconds) => {
      if (!prepared) return;
      guarded(() => mixer.seek(Math.max(0, seconds)));
    },
    setGains: (gains) => {
      guarded(() => mixer.setGains(gains.vocal, gains.instrumental, gains.master));
    },
    setEq: (bands, enabled) => {
      guarded(() => mixer.setEq(bands.low, bands.mid, bands.high, enabled));
    },
    setRate: (rate) => {
      guarded(() => mixer.setRate(rate));
    },
    onStatus: (cb) => {
      let subscription: StemMixerSubscription | null = null;
      try {
        subscription = mixer.addListener("statusUpdate", (status) => {
          // The native flag is the truth: a media-services reset drops
          // `prepared` without anyone in JS asking for it.
          prepared = status.prepared;
          cb({
            currentTime: status.currentTime,
            playing: status.playing,
            error: status.error,
          });
        });
      } catch {
        return noop;
      }
      const active = subscription;
      return () => {
        try {
          active.remove();
        } catch {
          // Already torn down with the module.
        }
      };
    },
    release: () => {
      prepared = false;
      guarded(() => mixer.release());
    },
    getStatus: () => {
      try {
        return mixer.getStatus();
      } catch {
        return null;
      }
    },
    resync: (referenceSeconds, toleranceSeconds) => {
      if (!prepared) return 0;
      try {
        return mixer.resync(referenceSeconds, Math.max(0, toleranceSeconds));
      } catch {
        return 0;
      }
    },
  };
};
