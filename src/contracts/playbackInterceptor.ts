/**
 * Playback interceptor seam (DESIGN.md 13.4). WP10's jam follower registers
 * proposal interception: while following a jam with queue_mode "everyone",
 * a "user" play of an own-library song becomes a jam proposal and nothing
 * plays locally. Default: no interceptor.
 */
import type { Song } from "@/domain/song";

/** Return true when the play was consumed (nothing should play locally). */
export type PlaybackInterceptor = (song: Song) => boolean;

let interceptor: PlaybackInterceptor | null = null;

export const setPlaybackInterceptor = (fn: PlaybackInterceptor | null): void => {
  interceptor = fn;
};

export const getPlaybackInterceptor = (): PlaybackInterceptor | null => interceptor;
