/**
 * The follower's audio backend over expo-audio's createAudioPlayer (verified
 * against node_modules/expo-audio/build/*.d.ts). A SECOND player, entirely
 * separate from the engine's: the engine keeps the user's own queue and the
 * lock screen, this one only ever plays the host's presigned stream.
 *
 * Deliberately never calls setActiveForLockScreen: the lock screen describes
 * what the user is hearing about from their OWN playback, and a follower's
 * transport is the host's, not theirs.
 *
 * Imported ONLY by jam/register.ts, so followerPlayer.ts stays runnable
 * under bun with a fake.
 */
import { createAudioPlayer } from "expo-audio";
import type { AudioPlayer, AudioStatus } from "expo-audio";
import type { FollowerAudio, FollowerAudioStatus } from "./types";

const STATUS_INTERVAL_MS = 250;

/**
 * Static-export gate, same story as player/expoAudioAdapter.ts: the Node
 * prerender of `expo export -p web` has no DOM `Audio`, and expo-audio's web
 * `createAudioPlayer` constructs one on the spot. FollowerPlayer only builds
 * its player lazily (ensurePlayer on the first jam state), so this branch is
 * defence in depth rather than the crash site - but a follower that could be
 * constructed during SSG must stay inert, never explode.
 */
const createInertPrerenderAudio = (): FollowerAudio => ({
  currentTime: 0,
  playing: false,
  replace: () => {},
  play: () => {},
  pause: () => {},
  seekTo: () => Promise.resolve(),
  setVolume: () => {},
  onStatus: () => () => {},
  remove: () => {},
});

export const createExpoFollowerAudio = (): FollowerAudio => {
  if (typeof window === "undefined") return createInertPrerenderAudio();
  const player: AudioPlayer = createAudioPlayer(null, {
    updateInterval: STATUS_INTERVAL_MS,
  });

  return {
    get currentTime(): number {
      return player.currentTime;
    },
    get playing(): boolean {
      return player.playing;
    },
    replace(uri: string | null): void {
      player.replace(uri === null ? null : { uri });
    },
    play(): void {
      player.play();
    },
    pause(): void {
      player.pause();
    },
    seekTo(seconds: number): Promise<void> {
      return player.seekTo(seconds);
    },
    setVolume(v: number): void {
      player.volume = Math.min(1, Math.max(0, v));
    },
    onStatus(cb: (s: FollowerAudioStatus) => void): () => void {
      const sub = player.addListener("playbackStatusUpdate", (status: AudioStatus) => {
        cb({
          currentTime: status.currentTime,
          duration: Number.isFinite(status.duration) ? status.duration : 0,
          playing: status.playing,
          isLoaded: status.isLoaded,
        });
      });
      return () => sub.remove();
    },
    remove(): void {
      player.remove();
    },
  };
};
