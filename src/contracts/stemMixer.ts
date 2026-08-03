/**
 * Stem mixer seam (DESIGN 16.1 amendment 2026-08-03). The native package
 * (`modules/oms-stem-mixer`) installs the real mixer here; until it lands the
 * inert default reports itself unavailable, so this package compiles, tests
 * green and the app keeps playing the plain mix.
 *
 * The mixer produces the audio for `custom` mode ONLY. The expo-audio player
 * stays loaded on the original file, MUTED (gain law: `mainGain = 0`), as the
 * transport clock and the owner of the lock screen / media session - exactly
 * what frontend/lib/vocalSeparation.ts does with `mainGain = 0`. That is why
 * this interface has no metadata, no queue and no duration: it is an audio
 * source, not a player.
 *
 * Contract the implementation must honour:
 *  - `prepare` takes two LOCAL file uris and resolves only when BOTH are
 *    ready to play; a half mix must never be audible;
 *  - both stems start and restart TOGETHER, one clock, one start pair, on
 *    every transport event (web parity, vocalSeparation.ts:370-393/:408-425);
 *  - `setGains` / `setEq` / `setRate` are live parameter writes: they never
 *    restart the sources.
 */
import type { EqBands } from "@/domain/playback";

export interface StemMixerGains {
  vocal: number;
  instrumental: number;
  /** The mixer's output gain, i.e. the device volume while stems are on. */
  master: number;
}

export interface StemMixerStatus {
  /** The mixer's own clock in seconds (the main player stays authoritative). */
  currentTime: number;
  playing: boolean;
  /** Non-null once the mixer gave up; the caller falls back to the mix. */
  error: string | null;
}

export interface StemMixer {
  /** False when no native mixer is in this binary (Expo Go, web, old builds). */
  isAvailable(): boolean;
  /**
   * Load both LOCAL stem files. Resolves when both are ready to play,
   * rejects when either cannot be opened - the caller then stays on the
   * plain mix rather than playing a half mix.
   */
  prepare(vocalsUri: string, instrumentalUri: string): Promise<void>;
  play(): void;
  pause(): void;
  /** Stop and re-schedule BOTH stems at the same offset (one start pair). */
  seek(seconds: number): void;
  setGains(gains: StemMixerGains): void;
  /** Bands are pre-clamped to -12..+12 dB; `enabled: false` bypasses them. */
  setEq(bands: EqBands, enabled: boolean): void;
  /** Rate with deliberate pitch shift (FR-64), same value as the main player. */
  setRate(rate: number): void;
  onStatus(cb: (s: StemMixerStatus) => void): () => void;
  /** Stop both sources and release the graph. Idempotent. */
  release(): void;
  /**
   * OPTIONAL drift safety, and the ONLY way the blend can follow a transport
   * change it never saw. expo-audio's lock-screen play / pause / seek targets
   * act directly on its own player and never reach JS
   * (node_modules/expo-audio/ios/MediaController.swift:234-306), so a scrub or
   * a 10 s skip from the lock screen moves the muted clock while the mixer
   * stays put.
   *
   * Hands the reference player's position to the mixer, which compares it
   * against ITS OWN clock natively (the only place that clock is exact) and
   * re-pairs both stems onto the reference only past `toleranceSeconds`.
   * Returns the measured (mixer - reference) drift either way. Optional so the
   * inert default and any future mixer without one stay valid.
   */
  resync?(referenceSeconds: number, toleranceSeconds: number): number;
}

const noop = (): void => {};

const inertMixer: StemMixer = {
  isAvailable: () => false,
  prepare: () => Promise.reject(new Error("Stem mixer unavailable")),
  play: noop,
  pause: noop,
  seek: noop,
  setGains: noop,
  setEq: noop,
  setRate: noop,
  onStatus: () => noop,
  release: noop,
  resync: () => 0,
};

let current: StemMixer = inertMixer;

/** The native module's register installs the real mixer here. */
export const setStemMixer = (mixer: StemMixer | null): void => {
  current = mixer ?? inertMixer;
};

/** Resolve at call time, never at import: the mixer registers after boot. */
export const getStemMixer = (): StemMixer => current;
