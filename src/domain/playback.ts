import type { Song } from "./song";

export type LoopMode = "none" | "one" | "all";
export type PlaybackMode = "original" | "instrumental" | "vocals" | "custom";

/**
 * Per-stem gains for the custom blend, 0..1 each (web `vocalVolume` /
 * `instrumentalVolume`). Both at 1.0 reproduce the original at roughly unity:
 * the separator's two stems sum back to the mix.
 */
export interface StemGains {
  vocal: number;
  instrumental: number;
}

/** 3-band EQ in dB, clamped -12..+12 (FR-70). Flat is 0 on every band. */
export interface EqBands {
  low: number;
  mid: number;
  high: number;
}

/** The queue quartet. currentSong = queue[queueOrder[queueIndex]]. */
export interface QueueState {
  queue: Song[];
  queueOrder: number[];
  queueIndex: number;
  shuffle: boolean;
}

export interface PlaybackSnapshot {
  v?: number;
  active_device_id: string | null;
  song_id: string | null;
  position: number;
  paused: boolean;
  queue: string[];
  queue_index: number;
  queue_order: number[];
  loop_mode: LoopMode; // default "all"
  shuffle: boolean;
  volume: number; // device-local, never adopted
  playback_rate?: number;
  playback_mode?: PlaybackMode;
  eq_low?: number;
  eq_mid?: number;
  eq_high?: number;
  eq_enabled?: boolean;
  separation_enabled?: boolean;
  vocal_volume?: number;
  instrumental_volume?: number;
  queue_songs?: Song[]; // omitted on slim state_changed
}

export interface PlaybackDevice {
  id: string;
  label: string;
  name?: string;
  device_type: string;
  description?: string;
  last_seen_at?: string;
  last_used_at?: string;
  online: boolean;
}
