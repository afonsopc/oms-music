/**
 * The real AudioAdapter over expo-audio's createAudioPlayer (verified
 * against node_modules/expo-audio/build/*.d.ts). One player for the app
 * lifetime; sources swap via replace(). Rate is applied with
 * shouldCorrectPitch = false (deliberate pitch shift, FR-64). Status events
 * arrive at the engine's 4 Hz cadence via updateInterval.
 *
 * Imported ONLY by player/register.ts - never by the engine or tests, so
 * the engine logic stays runnable under bun with a FakeAudioPlayer.
 */
import { createAudioPlayer } from "expo-audio";
import type { AudioPlayer, AudioStatus } from "expo-audio";
import type { AudioAdapter, AudioAdapterStatus, LockScreenMetadata } from "./types";

const STATUS_INTERVAL_MS = 250;

const toAdapterStatus = (s: AudioStatus): AudioAdapterStatus => ({
  currentTime: s.currentTime,
  duration: Number.isFinite(s.duration) ? s.duration : 0,
  playing: s.playing,
  isBuffering: s.isBuffering,
  isLoaded: s.isLoaded,
  didJustFinish: s.didJustFinish,
  error: s.error,
});

export const createExpoAudioAdapter = (): AudioAdapter => {
  const player: AudioPlayer = createAudioPlayer(null, {
    updateInterval: STATUS_INTERVAL_MS,
  });
  player.shouldCorrectPitch = false;
  let sourceUri: string | null = null;

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
    setVolume(v: number): void {
      player.volume = Math.min(1, Math.max(0, v));
    },
    play(): void {
      player.play();
    },
    pause(): void {
      player.pause();
    },
    replace(uri: string | null): void {
      sourceUri = uri;
      player.replace(uri === null ? null : { uri });
    },
    seekTo(seconds: number): Promise<void> {
      return player.seekTo(seconds);
    },
    setRate(rate: number): void {
      player.shouldCorrectPitch = false;
      player.setPlaybackRate(rate);
    },
    onStatus(cb: (s: AudioAdapterStatus) => void): () => void {
      const sub = player.addListener("playbackStatusUpdate", (status: AudioStatus) => {
        cb(toAdapterStatus(status));
      });
      return () => sub.remove();
    },
    setLockScreenActive(active: boolean, metadata?: LockScreenMetadata): void {
      player.setActiveForLockScreen(active, metadata, {
        showSeekForward: true,
        showSeekBackward: true,
      });
    },
    updateLockScreenMetadata(metadata: LockScreenMetadata): void {
      player.updateLockScreenMetadata(metadata);
    },
    remove(): void {
      player.remove();
    },
  };
};
