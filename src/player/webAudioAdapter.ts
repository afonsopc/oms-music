/**
 * The web AudioAdapter over a plain HTMLAudioElement (F1). expo-audio's web
 * player is deliberately NOT used here: measured in a real Chrome against a
 * stallable stream (F0 spike 2), it breaks three premises the engine's
 * watchdogs were built on:
 *
 *  - `play()` fire-and-forgets the element's promise and flips its own
 *    `isPlaying` flag to true anyway, so an autoplay-policy rejection
 *    (NotAllowedError) leaves a ghost "playing" state: toggle() inverts
 *    (the first tap on play PAUSES) and checkStuckPlayback never runs
 *    because `player.playing` lies;
 *  - `isBuffering` is hardcoded false, so the engine's buffer-drain guard
 *    (RECENT_BUFFER_WINDOW_MS) never protects anything and `lastBufferingAt`
 *    stays at -Infinity forever;
 *  - statuses only ride media events, and a starved network emits NO events
 *    at all while `media.paused` stays false - 25 s of measured famine
 *    produced ZERO statuses, so the status watchdog cannot tick and the
 *    wall-clock checker is gated off by the lying `playing`. An indefinite
 *    stall (expired presigned URL mid-track) is eternal silence marked as
 *    "playing".
 *
 * This adapter answers each point structurally:
 *
 *  1. `playing` is HONEST, derived from the element every read:
 *     `!paused && !ended && readyState > HAVE_CURRENT_DATA` - never a flag.
 *  2. `isBuffering` is derived the same way: the element WANTS to play but
 *     lacks data. Synchronous derivation (not event-edge bookkeeping)
 *     matters: the playing->false flip and `isBuffering: true` land in the
 *     SAME status, so the engine's interruption detector can never read a
 *     starvation flip as an external pause and clear the play intent - the
 *     exact silent permanent stop of the 2026-08-10 report.
 *  3. A synthetic 4 Hz status pump runs while a source is loaded, so the
 *     engine's stall watchdog (STALL_TICKS) and wall-clock stuck checker
 *     work as designed even when the element emits nothing.
 *  4. `didJustFinish` is an EDGE, emitted once from the `ended` event. The
 *     element's `ended` property is a LEVEL, and level + pump would re-run
 *     handleEnded every 250 ms (double queue advance).
 *  5. `play()` awaits the promise. NotAllowedError goes out the dedicated
 *     onAutoplayBlocked channel (NOT status.error: the stream-error ladder
 *     would burn the recovery attempt and walk the queue in silence).
 *  6. `replace()` is INERT: pause + new src + load. expo-audio's web
 *     replace() auto-resumes when its flag said playing, which on the
 *     recovery path (handleStreamError -> beginLoad with no preceding
 *     pause) could restart audio against the engine's intent. The engine's
 *     `autoplay && intendedPlay` gate is the only resume decision-maker.
 *
 * The element factory, media session and timers are injectable so the whole
 * file runs under bun with fakes (same discipline as the engine's deps).
 * Imported by expoAudioAdapter.web.ts (the Metro platform fork register.ts
 * resolves on web) and by tests - never by native code.
 */
import { clampUnit } from "./gainLaw";
import type { AudioAdapter, AudioAdapterStatus, LockScreenMetadata } from "./types";

/** Same cadence as the native adapter's updateInterval (engine contract). */
const STATUS_PUMP_MS = 250;
/** HTMLMediaElement.readyState levels (lib.dom constants, inlined so the
 *  file needs no DOM globals under bun). */
const HAVE_METADATA = 1;
const HAVE_CURRENT_DATA = 2;
/** Media-session seek jump, matching expo-audio's native +-10 s targets. */
const SEEK_JUMP_S = 10;

/**
 * The 0-sample silent WAV played inside the first user gesture to unlock the
 * origin's autoplay - the exact trick docs/api-social-jams.md documents for
 * the old web client's jam join tap. 44 bytes of RIFF header, zero data.
 */
export const SILENT_UNLOCK_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";

/** The slice of HTMLAudioElement this adapter touches, structural so bun
 *  tests fake it without a DOM. A real HTMLAudioElement satisfies it. */
export interface WebMediaElement {
  currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  readonly ended: boolean;
  readonly readyState: number;
  playbackRate: number;
  preservesPitch: boolean;
  volume: number;
  preload: string;
  readonly error: { code: number; message?: string } | null;
  src: string;
  play(): Promise<void>;
  pause(): void;
  load(): void;
  removeAttribute(name: string): void;
  addEventListener(type: string, cb: () => void): void;
  removeEventListener(type: string, cb: () => void): void;
}

export interface WebAudioAdapterEnv {
  /** Element factory; tests inject a fake, the browser gets `new Audio()`. */
  createMedia?: () => WebMediaElement;
  /** Media session sink; `null` disables (tests, browsers without it). */
  mediaSession?: MediaSession | null;
  /**
   * Hardware media keys / browser media hub next & previous. Wired by the
   * register shim through the transport seam (FR-63), so a controller tab
   * advances the ACTIVE device - unlike expo-audio's web controller, which
   * maps nexttrack/previoustrack onto +-10 s seeks. Absent -> no handlers.
   */
  onRemoteTrackCommand?: (kind: "next" | "previous") => void;
  /** Timer seams for the status pump (bun tests drive ticks by hand). */
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

/**
 * Static-export gate, same story as expoAudioAdapter.ts's: the Node
 * prerender of `expo export -p web` builds the engine at import time and has
 * no DOM `Audio`. The prerender only needs the adapter's SHAPE; an inert
 * adapter is safer than shimming a global.
 */
const createInertPrerenderAdapter = (): AudioAdapter => ({
  currentTime: 0,
  duration: 0,
  playing: false,
  hasSource: false,
  setVolume: () => {},
  play: () => {},
  pause: () => {},
  replace: () => {},
  seekTo: () => Promise.resolve(),
  setRate: () => {},
  onStatus: () => () => {},
  setLockScreenActive: () => {},
  updateLockScreenMetadata: () => {},
  remove: () => {},
  // No stem members: an adapter without a mixer is already a legal shape.
});

export const createWebAudioAdapter = (env: WebAudioAdapterEnv = {}): AudioAdapter => {
  if (!env.createMedia && typeof window === "undefined") {
    return createInertPrerenderAdapter();
  }
  const media = (env.createMedia ?? (() => new Audio()))();
  // The engine resolves a source and expects it to start fetching before
  // play() lands (its `buffering` spinner covers exactly that window).
  media.preload = "auto";
  const mediaSession =
    env.mediaSession !== undefined
      ? env.mediaSession
      : typeof navigator !== "undefined"
        ? (navigator.mediaSession ?? null)
        : null;
  const schedule =
    env.schedule ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
  const cancel =
    env.cancel ?? ((handle: unknown) => clearInterval(handle as ReturnType<typeof setInterval>));

  let sourceUri: string | null = null;
  /**
   * Bumped by every replace(): a play() promise that settles AFTER its
   * source was swapped away belongs to a dead world. Without this, the
   * NotAllowedError of an abandoned source could raise the autoplay
   * affordance over a track the engine already moved past.
   */
  let loadGen = 0;
  /** Set by the `ended` listener, consumed by exactly ONE status (point 4). */
  let finishedEdge = false;
  /** One-shot error from a rejected play() (e.g. NotSupportedError). */
  let playError: string | null = null;
  let pump: unknown = null;
  let removed = false;
  let msActive = false;
  /**
   * Cleared the first time a volume write does not stick (iOS Safari). Starts
   * optimistic: assuming the platform works until it demonstrably does not is
   * the only reading that cannot be wrong about a platform we have not met.
   */
  let volumeWritable = true;
  const statusListeners = new Set<(s: AudioAdapterStatus) => void>();
  const blockedListeners = new Set<() => void>();

  // ----- honest element reads (points 1 and 2) -----------------------------

  /** What getStatusFromMedia SHOULD say: wants to play, and has the data. */
  const honestPlaying = (): boolean =>
    !media.paused && !media.ended && media.readyState > HAVE_CURRENT_DATA;

  /** Wants to play, LACKS the data: buffering by definition, no events
   *  needed. Synchronous on purpose - see the header, point 2. */
  const starving = (): boolean =>
    !media.paused && !media.ended && media.readyState <= HAVE_CURRENT_DATA;

  const safeDuration = (): number =>
    Number.isFinite(media.duration) ? media.duration : 0;

  const buildStatus = (): AudioAdapterStatus => {
    const mediaError = media.error;
    const status: AudioAdapterStatus = {
      currentTime: media.currentTime,
      duration: safeDuration(),
      playing: honestPlaying(),
      isBuffering: sourceUri !== null && starving(),
      isLoaded: sourceUri !== null && media.readyState >= HAVE_METADATA,
      didJustFinish: finishedEdge,
      error:
        playError ?? (mediaError ? `Playback error (code ${mediaError.code})` : null),
    };
    // Both edges are consumed by the ONE status that carries them; the
    // engine dedupes errors per candidate anyway, but didJustFinish MUST
    // never repeat (double advance).
    finishedEdge = false;
    playError = null;
    return status;
  };

  const emitStatus = (): void => {
    if (removed) return;
    const status = buildStatus();
    for (const cb of [...statusListeners]) cb(status);
  };

  // ----- status pump (point 3) ---------------------------------------------

  const stopPump = (): void => {
    if (pump === null) return;
    cancel(pump);
    pump = null;
  };

  const startPump = (): void => {
    if (pump !== null || removed) return;
    pump = schedule(emitStatus, STATUS_PUMP_MS);
    // Keeps bun/node test processes exiting cleanly; browsers have no unref.
    (pump as { unref?: () => void } | null)?.unref?.();
  };

  // ----- media session (lock screen parity) --------------------------------

  const setHandler = (
    action: MediaSessionAction,
    handler: MediaSessionActionHandler | null,
  ): void => {
    if (!mediaSession) return;
    try {
      mediaSession.setActionHandler(action, handler);
    } catch {
      // Unknown action on this browser: skip it, never break playback.
    }
  };

  const updatePlaybackState = (): void => {
    if (!mediaSession || !msActive) return;
    mediaSession.playbackState = honestPlaying() ? "playing" : "paused";
  };

  const updatePositionState = (): void => {
    if (!mediaSession || !msActive) return;
    const duration = safeDuration();
    if (duration <= 0) return;
    try {
      mediaSession.setPositionState({
        duration,
        playbackRate: media.playbackRate || 1,
        position: Math.min(Math.max(media.currentTime, 0), duration),
      });
    } catch {
      // Position state is cosmetic; a picky browser must not break audio.
    }
  };

  const applyMetadata = (metadata?: LockScreenMetadata): void => {
    if (!mediaSession) return;
    if (!metadata || typeof MediaMetadata === "undefined") {
      mediaSession.metadata = null;
      return;
    }
    mediaSession.metadata = new MediaMetadata({
      title: metadata.title ?? "",
      artist: metadata.artist ?? "",
      album: metadata.albumTitle ?? "",
      artwork: metadata.artworkUrl ? [{ src: metadata.artworkUrl }] : [],
    });
  };

  const MEDIA_SESSION_ACTIONS: MediaSessionAction[] = [
    "play",
    "pause",
    "seekto",
    "seekforward",
    "seekbackward",
    "nexttrack",
    "previoustrack",
  ];

  const clearMediaSession = (): void => {
    if (!mediaSession || !msActive) return;
    msActive = false;
    mediaSession.metadata = null;
    mediaSession.playbackState = "none";
    for (const action of MEDIA_SESSION_ACTIONS) setHandler(action, null);
    try {
      mediaSession.setPositionState();
    } catch {
      // Best-effort reset.
    }
  };

  // ----- transport ---------------------------------------------------------

  const play = (): void => {
    if (removed || sourceUri === null) return;
    const gen = loadGen;
    // The browser reports its autoplay policy in the PROMISE, never as an
    // element event. Fire-and-forget (what expo-audio's web build does) is
    // exactly the ghost-playing bug this adapter exists to fix.
    let p: Promise<void> | undefined;
    try {
      p = media.play();
    } catch (e) {
      handlePlayFailure(gen, e);
      return;
    }
    void p?.then(() => emitStatus(), (e: unknown) => handlePlayFailure(gen, e));
  };

  const handlePlayFailure = (gen: number, e: unknown): void => {
    if (removed || gen !== loadGen) return; // stale: source swapped meanwhile
    const name = (e as { name?: string } | null)?.name;
    if (name === "AbortError") {
      // play() superseded by a pause()/replace() of our own: not a failure.
      return;
    }
    if (name === "NotAllowedError") {
      // Autoplay policy refusal. The source is FINE and nothing is wedged,
      // so this must NOT ride status.error into the stream-error ladder
      // (it would burn the song's one recovery attempt, then mark it failed
      // and advance - a never-clicked tab would walk the whole queue in
      // silence). Dedicated channel; the engine clears its intent.
      for (const cb of [...blockedListeners]) cb();
      emitStatus();
      return;
    }
    // Real failure (NotSupportedError and friends): the candidate ladder
    // and the recovery ladder are the right owners.
    playError = e instanceof Error && e.message ? e.message : "media.play() failed";
    emitStatus();
  };

  const pause = (): void => {
    if (removed) return;
    media.pause();
    // The element also fires a `pause` event (async task); emitting here as
    // well makes the flip visible to the engine in the same tick, and a
    // duplicate status is harmless by design.
    updatePlaybackState();
    emitStatus();
  };

  const seekTo = (seconds: number): Promise<void> => {
    try {
      media.currentTime = Math.max(0, seconds);
      updatePositionState();
      return Promise.resolve();
    } catch (e) {
      // seekWithRetry's ladder owns retries; report the failure honestly.
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
  };

  // ----- element events ----------------------------------------------------

  const onEnded = (): void => {
    // EDGE, not level: `media.ended` stays true until the next seek/load,
    // and the pump samples 4x a second (header, point 4).
    finishedEdge = true;
    updatePlaybackState();
    emitStatus();
  };

  const mediaEvents: [string, () => void][] = [
    // pendingSeek applies on the first status with metadata: surface it now,
    // not up to 250 ms later at the next pump tick.
    ["loadedmetadata", () => {
      updatePositionState();
      emitStatus();
    }],
    ["loadeddata", emitStatus],
    ["canplay", emitStatus],
    // playing/pause: the engine mirrors flips and detects EXTERNAL pauses
    // (media keys, OS) from these - our own transport calls emit too, and
    // duplicates are harmless.
    ["playing", () => {
      updatePlaybackState();
      emitStatus();
    }],
    ["pause", () => {
      updatePlaybackState();
      emitStatus();
    }],
    // waiting/stalled carry no state of their own here (isBuffering is
    // derived synchronously) but each one is a free, timely status.
    ["waiting", emitStatus],
    ["stalled", emitStatus],
    ["seeked", () => {
      updatePositionState();
      emitStatus();
    }],
    ["ended", onEnded],
    ["error", emitStatus],
  ];
  for (const [type, fn] of mediaEvents) media.addEventListener(type, fn);

  // ----- the adapter -------------------------------------------------------

  return {
    get currentTime(): number {
      return media.currentTime;
    },
    get duration(): number {
      return safeDuration();
    },
    get playing(): boolean {
      // Honest by construction (header, point 1): a blocked play() leaves
      // `paused` true, a starved network drops readyState - both read as
      // NOT playing, which is what toggle() and checkStuckPlayback need.
      return honestPlaying();
    },
    get hasSource(): boolean {
      return sourceUri !== null;
    },
    setVolume(v: number): void {
      const wanted = clampUnit(v);
      media.volume = wanted;
      // iOS Safari makes HTMLMediaElement.volume READ-ONLY: the assignment
      // above is silently ignored and output stays wherever the hardware
      // buttons put it, which is why the owner's volume bar did nothing there
      // (report 2026-08-16, point 7). Probing the read-back is how we learn -
      // no user-agent sniffing, which would be a guess about a behaviour we
      // can simply observe, and would go stale the day WebKit changes its
      // mind. One failed write is enough to know for the whole session.
      if (volumeWritable && Math.abs(media.volume - wanted) > 0.01) {
        volumeWritable = false;
      }
    },
    supportsVolume(): boolean {
      return volumeWritable;
    },
    play,
    pause,
    replace(uri: string | null): void {
      // INERT by contract (header, point 6): the engine alone decides
      // whether the new source plays. Never auto-resume here.
      loadGen++;
      finishedEdge = false;
      playError = null;
      media.pause();
      if (uri === null) {
        sourceUri = null;
        stopPump();
        // removeAttribute, NOT src = "": an empty src makes the element
        // fire a spurious MEDIA_ERR_SRC_NOT_SUPPORTED error event.
        media.removeAttribute("src");
        media.load();
        return;
      }
      sourceUri = uri;
      media.src = uri;
      media.load(); // resets readyState and error, starts the preload fetch
      startPump();
    },
    seekTo,
    setRate(rate: number): void {
      media.playbackRate = rate;
      // shouldCorrectPitch = false everywhere (FR-64 deliberate pitch shift).
      media.preservesPitch = false;
      updatePositionState();
    },
    onStatus(cb: (s: AudioAdapterStatus) => void): () => void {
      statusListeners.add(cb);
      return () => statusListeners.delete(cb);
    },
    onAutoplayBlocked(cb: () => void): () => void {
      blockedListeners.add(cb);
      return () => blockedListeners.delete(cb);
    },
    setLockScreenActive(active: boolean, metadata?: LockScreenMetadata): void {
      if (!mediaSession) return;
      if (!active) {
        clearMediaSession();
        return;
      }
      msActive = true;
      applyMetadata(metadata);
      setHandler("play", () => play());
      setHandler("pause", () => pause());
      setHandler("seekto", (details) => {
        if (details.seekTime != null) void seekTo(details.seekTime);
      });
      // Track navigation OUTRANKS the seek jumps (owner report 2026-08-16,
      // point 8). A media session advertises more actions than any lock
      // screen has room for, and the platforms resolve that themselves:
      // Safari draws its skip-interval buttons (15 s, its own default) in
      // place of previous/next as soon as seekbackward/seekforward have
      // handlers, which is exactly what left the owner unable to change
      // track from the iOS lock screen. Registering the pair only when
      // nothing owns next/previous keeps the jumps for the builds that have
      // no track commands to lose, and the scrubber still seeks everywhere.
      const onTrack = env.onRemoteTrackCommand;
      setHandler("nexttrack", onTrack ? () => onTrack("next") : null);
      setHandler("previoustrack", onTrack ? () => onTrack("previous") : null);
      setHandler(
        "seekforward",
        onTrack
          ? null
          : (details) => {
              void seekTo(
                Math.min(
                  media.currentTime + (details.seekOffset ?? SEEK_JUMP_S),
                  safeDuration(),
                ),
              );
            },
      );
      setHandler(
        "seekbackward",
        onTrack
          ? null
          : (details) => {
              void seekTo(Math.max(media.currentTime - (details.seekOffset ?? SEEK_JUMP_S), 0));
            },
      );
      updatePlaybackState();
      updatePositionState();
    },
    updateLockScreenMetadata(metadata: LockScreenMetadata): void {
      if (!msActive) return;
      applyMetadata(metadata);
    },
    remove(): void {
      removed = true;
      stopPump();
      clearMediaSession();
      for (const [type, fn] of mediaEvents) media.removeEventListener(type, fn);
      media.pause();
      media.removeAttribute("src");
      media.load();
      sourceUri = null;
      statusListeners.clear();
      blockedListeners.clear();
    },
    // No stem members: `custom` mode reports itself unsupported on the web,
    // exactly like a mixerless native build (the plain mix keeps playing).
  };
};

// ----- autoplay unlock (F1 item C) -----------------------------------------

/** The document slice the unlock touches; structural for bun tests. */
export interface UnlockDocument {
  addEventListener(type: string, cb: () => void, capture?: boolean): void;
  removeEventListener(type: string, cb: () => void, capture?: boolean): void;
}

export interface AutoplayUnlockEnv {
  doc?: UnlockDocument | null;
  createUnlockMedia?: () => { play(): Promise<void> };
}

/**
 * Chrome's autoplay gate is sticky per page: after ONE user interaction with
 * the origin, media.play() is allowed for good. Playing a 0-sample silent
 * WAV inside the first gesture makes that unlock explicit (and covers
 * WebKit-style per-element policies), which demotes the blocked-autoplay
 * affordance from the common case to the rare one: a remote play adopted by
 * a tab nobody ever touched. Same trick the old web client runs inside the
 * jam join tap (docs/api-social-jams.md).
 *
 * Returns an uninstaller (idempotent; the listener also uninstalls itself
 * after the first gesture).
 */
export const installAutoplayUnlock = (env: AutoplayUnlockEnv = {}): (() => void) => {
  const doc =
    env.doc !== undefined ? env.doc : typeof document !== "undefined" ? document : null;
  if (!doc) return () => {};
  const createUnlockMedia =
    env.createUnlockMedia ?? (() => new Audio(SILENT_UNLOCK_WAV));
  const GESTURES = ["pointerdown", "keydown", "touchend"] as const;
  const onGesture = (): void => {
    for (const type of GESTURES) doc.removeEventListener(type, onGesture, true);
    try {
      // Throwaway element on purpose: the adapter's element may hold a real
      // source, and the unlock must never clobber it.
      void createUnlockMedia()
        .play()
        .catch(() => undefined);
    } catch {
      // The unlock is best-effort; the engine's affordance covers refusal.
    }
  };
  // Capture phase: the unlock must win even when a handler stops propagation.
  for (const type of GESTURES) doc.addEventListener(type, onGesture, true);
  return () => {
    for (const type of GESTURES) doc.removeEventListener(type, onGesture, true);
  };
};
