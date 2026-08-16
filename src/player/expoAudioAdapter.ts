/**
 * The real AudioAdapter over expo-audio's createAudioPlayer (verified
 * against node_modules/expo-audio/build/*.d.ts). One player for the app
 * lifetime; sources swap via replace(). Rate is applied with
 * shouldCorrectPitch = false (deliberate pitch shift, FR-64). Status events
 * arrive at the engine's 4 Hz cadence via updateInterval.
 *
 * Custom blend (DESIGN 16.1 amendment 2026-08-03): this adapter also owns the
 * stem mixer seam (contracts/stemMixer). While the stems are active the
 * expo-audio player stays loaded on the plain mix but MUTED by the gain law -
 * it remains the transport clock and the owner of the lock screen / media
 * session, so we never fight expo-audio for MPRemoteCommandCenter or the
 * Android MediaSession. That is precisely what the web does with
 * `mainGain = 0` in frontend/lib/vocalSeparation.ts.
 *
 * The fan-out lives HERE, not in the engine: play / pause / seekTo / setRate
 * drive both the muted original and the mixer, and `replace` (a new main
 * source) always releases the mixer first, because stems can never survive a
 * track change.
 *
 * Imported ONLY by player/register.ts - never by the engine or tests, so
 * the engine logic stays runnable under bun with a FakeAudioPlayer.
 */
import { Platform } from "react-native";
import { createAudioPlayer } from "expo-audio";
import type { AudioPlayer, AudioStatus } from "expo-audio";
import { getStemMixer } from "@/contracts/stemMixer";
import type { EqBands, StemGains } from "@/domain/playback";
import { clampEqBands, clampStemGains, clampUnit, gainLaw, PASSTHROUGH_GAINS } from "./gainLaw";
import type { AudioAdapter, AudioAdapterStatus, LockScreenMetadata } from "./types";

const STATUS_INTERVAL_MS = 250;

/**
 * Whether the lock screen offers the +-10 s skip buttons (owner report
 * 2026-08-16, point 8: "the 15 second buttons take the place of
 * previous/next, which stops me changing track").
 *
 * iOS draws at most three transport buttons either side of play/pause, and
 * MPRemoteCommandCenter gives the skip-interval commands PRIORITY over
 * nextTrack/previousTrack: enabling skipForward/skipBackward is what hid the
 * two buttons `modules/oms-native` exists to provide, and the system's own
 * default interval (15 s, since expo-audio pins no preferredIntervals) is
 * what the owner saw. Changing tracks is worth more than a 10 s nudge the
 * scrubber can do anyway, so iOS turns them off.
 *
 * Android keeps them: expo-audio strips the track-navigation commands from
 * the only MediaSession the app has (docs/LOCKSCREEN-PATCH.md section 6), so
 * there is no next/previous to make room FOR, and turning the skips off
 * there would leave the notification with play/pause alone.
 */
const SHOW_LOCK_SCREEN_SEEK_BUTTONS = Platform.OS !== "ios";

/**
 * How far the blend may sit from the muted reference clock before both stems
 * are re-paired onto it. Comfortably above the mixer's own start latency (the
 * iOS graph folds in a 20-100 ms lead it cannot observe on the AVPlayer side)
 * and far below a lock-screen skip, which is 10 s.
 */
const STEM_RESYNC_TOLERANCE_S = 0.5;

const toAdapterStatus = (s: AudioStatus): AudioAdapterStatus => ({
  currentTime: s.currentTime,
  duration: Number.isFinite(s.duration) ? s.duration : 0,
  playing: s.playing,
  isBuffering: s.isBuffering,
  isLoaded: s.isLoaded,
  didJustFinish: s.didJustFinish,
  error: s.error,
});

/**
 * Static-export gate. `expo export -p web` with `web.output: "static"`
 * prerenders every route in Node, and boot/wireup.ts builds the engine (and
 * therefore this adapter) at import time - before a single route renders.
 * expo-audio's web player constructs a DOM `Audio` element the moment
 * `createAudioPlayer` runs, and Node has no `Audio`, so without this gate the
 * whole export dies with `ReferenceError: Audio is not defined`.
 *
 * The prerender only ever needs the adapter's SHAPE (the engine subscribes to
 * status and applies persisted volume/rate during construction); no route can
 * start audio during SSG. An inert adapter is safer than shimming a global
 * `Audio`, because nothing half-real can leak into the emitted HTML. Every
 * browser and native runtime has `window`, so real users never take this
 * branch.
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
  // No stem members: an adapter without a mixer is already a legal shape, so
  // `custom` mode reports itself unsupported exactly like a mixerless build.
});

export const createExpoAudioAdapter = (): AudioAdapter => {
  if (typeof window === "undefined") return createInertPrerenderAdapter();
  const player: AudioPlayer = createAudioPlayer(null, {
    updateInterval: STATUS_INTERVAL_MS,
  });
  player.shouldCorrectPitch = false;
  let sourceUri: string | null = null;

  // Blend state. Gains and bands are remembered while the stems are OFF so
  // entering custom mode never plays one tick at the wrong level.
  let stemsOn = false;
  /** EQ-only blend: both nodes carry the MAIN file at PASSTHROUGH_GAIN. */
  let passthrough = false;
  let masterVolume = 1;
  let gains: StemGains = { vocal: 1, instrumental: 1 };
  let bands: EqBands = { low: 0, mid: 0, high: 0 };
  let eqEnabled = false;
  let rate = 1;
  /** What we last told the mixer to do; the reference for external changes. */
  let mixerPlaying = false;

  /** The ONE place the gain law reaches audio (player/gainLaw.ts). */
  const applyGains = (): void => {
    const law = gainLaw({
      masterVolume,
      stemsActive: stemsOn,
      vocalVolume: gains.vocal,
      instrumentalVolume: gains.instrumental,
    });
    player.volume = law.mainGain;
    if (stemsOn) {
      getStemMixer().setGains(
        passthrough
          ? // Same file on both nodes: the user's stem volumes must NOT
            // apply, or the "original" would quietly play at vocal+inst.
            // One node carries it at unity and the other is silent, so the
            // output never depends on the two agreeing to the sample (see
            // gainLaw.PASSTHROUGH_GAINS).
            {
              vocal: PASSTHROUGH_GAINS.vocal,
              instrumental: PASSTHROUGH_GAINS.instrumental,
              master: law.master,
            }
          : { vocal: law.vocal, instrumental: law.instrumental, master: law.master },
      );
    }
  };

  const applyEq = (): void => {
    if (!stemsOn) return;
    getStemMixer().setEq(bands, eqEnabled);
  };

  const releaseStems = (): void => {
    if (!stemsOn) return;
    stemsOn = false;
    passthrough = false;
    mixerPlaying = false;
    try {
      getStemMixer().release();
    } catch {
      // A mixer that cannot tear down must never take the audio with it.
    }
    applyGains(); // restores mainGain = device volume
  };

  /**
   * The blend follows transport changes THIS ADAPTER NEVER SAW.
   *
   * expo-audio owns the lock screen / media session by design (that is the
   * whole point of keeping its player loaded and muted), and its remote
   * command targets act straight on its own player without telling JS:
   * `player.ref.pause()`, `player.ref.seek(to:)`, the +-10 s skips
   * (node_modules/expo-audio/ios/MediaController.swift:234-306). An
   * interruption or an audio-focus loss arrives the same way. Without this,
   * pausing from the lock screen in custom mode would stop a player nobody
   * can hear and leave the blend playing on.
   *
   * Play state is mirrored EXACTLY: any disagreement means the change came
   * from outside. Position is handed to the mixer, which compares it against
   * its own clock natively - the only place that clock is exact - and
   * re-pairs both stems only past the tolerance, so the normal start latency
   * never causes a restart.
   */
  const followMainTransport = (status: AudioStatus): void => {
    if (!stemsOn) return;
    const mixer = getStemMixer();
    if (status.playing !== mixerPlaying) {
      mixerPlaying = status.playing;
      if (status.playing) mixer.play();
      else mixer.pause();
    }
    if (!status.playing || !Number.isFinite(status.currentTime)) return;
    mixer.resync?.(status.currentTime, STEM_RESYNC_TOLERANCE_S);
  };

  return {
    get currentTime(): number {
      return player.currentTime;
    },
    get duration(): number {
      return Number.isFinite(player.duration) ? player.duration : 0;
    },
    get playing(): boolean {
      return player.playing;
    },
    get hasSource(): boolean {
      return sourceUri !== null;
    },
    get stemsActive(): boolean {
      return stemsOn;
    },
    setVolume(v: number): void {
      masterVolume = clampUnit(v);
      applyGains();
    },
    play(): void {
      player.play();
      if (!stemsOn) return;
      mixerPlaying = true;
      getStemMixer().play();
    },
    pause(): void {
      player.pause();
      if (!stemsOn) return;
      mixerPlaying = false;
      getStemMixer().pause();
    },
    replace(uri: string | null): void {
      // A different file means different stems: never let a blend outlive it.
      releaseStems();
      sourceUri = uri;
      player.replace(uri === null ? null : { uri });
    },
    seekTo(seconds: number): Promise<void> {
      // Both stems restart together on every transport event (web parity):
      // that, not a drift loop, is what keeps them in sync.
      if (stemsOn) getStemMixer().seek(seconds);
      return player.seekTo(seconds);
    },
    setRate(next: number): void {
      rate = next;
      player.shouldCorrectPitch = false;
      player.setPlaybackRate(next);
      if (stemsOn) getStemMixer().setRate(next);
    },
    onStatus(cb: (s: AudioAdapterStatus) => void): () => void {
      const sub = player.addListener("playbackStatusUpdate", (status: AudioStatus) => {
        // Before the engine sees it: the blend has to catch a lock-screen
        // pause or scrub in the same tick the muted clock reports it.
        followMainTransport(status);
        cb(toAdapterStatus(status));
      });
      return () => sub.remove();
    },
    setLockScreenActive(active: boolean, metadata?: LockScreenMetadata): void {
      player.setActiveForLockScreen(active, metadata, {
        showSeekForward: SHOW_LOCK_SCREEN_SEEK_BUTTONS,
        showSeekBackward: SHOW_LOCK_SCREEN_SEEK_BUTTONS,
      });
    },
    updateLockScreenMetadata(metadata: LockScreenMetadata): void {
      player.updateLockScreenMetadata(metadata);
    },
    remove(): void {
      releaseStems();
      player.remove();
    },

    // ----- custom blend ----------------------------------------------------

    supportsStems(): boolean {
      return getStemMixer().isAvailable();
    },
    async replaceStems(
      vocalsUri: string,
      instrumentalUri: string,
      opts?: { passthrough?: boolean },
    ): Promise<void> {
      const mixer = getStemMixer();
      if (!mixer.isAvailable()) throw new Error("Stem mixer unavailable");
      // Drop any previous blend first: prepare() must never leave two graphs.
      releaseStems();
      // Rejects when either file cannot be opened - the caller keeps the
      // plain mix rather than playing a half mix.
      await mixer.prepare(vocalsUri, instrumentalUri);
      stemsOn = true;
      passthrough = !!opts?.passthrough;
      applyGains(); // mutes the original in the same tick the stems start
      applyEq();
      mixer.setRate(rate);
      // One start pair, aligned to the muted original's clock and state.
      mixer.seek(player.currentTime);
      mixerPlaying = player.playing;
      if (mixerPlaying) mixer.play();
      else mixer.pause();
    },
    setStemGains(next: StemGains): void {
      gains = clampStemGains(next);
      applyGains();
    },
    setEqBands(next: EqBands): void {
      bands = clampEqBands(next);
      applyEq();
    },
    setEqEnabled(on: boolean): void {
      eqEnabled = on;
      applyEq();
    },
    releaseStems,
  };
};
