/**
 * Player engine public contract (DESIGN.md 7.3, frozen after WP3 review) plus
 * the injectable dependency seams that keep the engine unit-testable in bun
 * (FakeAudioPlayer in CI, expo-audio on device via player/register.ts).
 */
import type { SongId, SongKey, FsNodeId } from "@/domain/ids";
import type { EqBands, LoopMode, PlaybackMode, QueueState, StemGains } from "@/domain/playback";
import type { Song } from "@/domain/song";

export type TransitionCause =
  | "user"
  | "auto"
  | "hydration"
  | "activation"
  | "recovery"
  | "mode"
  | "patch";

export type EngineEvent =
  | "songChanged"
  | "status"
  | "ended"
  | "audiblePlaying"
  | "streamError"
  | "queueChanged"
  | "playStateChanged";

export type SleepTimerSetting = { minutes: number } | { endOfSong: true } | null;

/** The frozen public API every consumer codes against (DESIGN 7.3). */
export interface PlayerEngine {
  // queue (delegate to queueOps, then reconcile the audio source)
  setQueue(songs: Song[], startIndex?: number, opts?: { shuffle?: boolean }): void;
  setQueueIndex(visibleIndex: number): void;
  setShuffle(on: boolean): void;
  addToQueue(song: Song): void;
  playNext(song: Song): void;
  reorderQueue(fromVisible: number, toVisible: number): void;
  removeFromQueue(visibleIndex: number): void;
  patchQueueSong(songId: SongId, patch: Partial<Song>): void; // cause "patch": never restarts
  adoptSnapshot(
    s: QueueState,
    opts: { position: number; paused: boolean; cause: "hydration" | "activation" },
  ): void;
  // transport
  play(): void;
  pause(): void;
  toggle(): void;
  next(cause?: TransitionCause): void;
  previous(): void;
  seek(seconds: number): void;
  setVolume(v: number): void;
  setRate(r: number): void;
  setLoopMode(m: LoopMode): void;
  setPlaybackMode(m: PlaybackMode): void;
  setSleepTimer(t: SleepTimerSetting): void;
  playFromIdle(): void; // re-resolves when the source was cleared (controller)
  stopAndClearSource(): void; // becoming controller: force-pause + clear
  // events
  on(event: EngineEvent, cb: (payload: unknown) => void): () => void;
}

/**
 * Additive extras beyond the frozen 7.3 surface, needed by WP9 (listener
 * settings adoption without volume), WP10 (host duties FIFO insertion) and
 * WP7/WP11 (separation toggle in the cog). Additions only - the frozen
 * surface above is untouched.
 */
export interface PlayerEngineExtras {
  getCurrentSong(): Song | null;
  getQueueState(): QueueState;
  /** False while a controller stint holds the player at a null source. */
  hasLoadedSource(): boolean;
  insertJamProposal(song: Song): void;
  /**
   * RAW setter, no cascade (web parity: `setSeparationEnabled`). Remote
   * adoption MUST use this one: the snapshot has to land exactly as it was
   * given, or adopting `{ playback_mode: "custom", separation_enabled: false }`
   * silently rewrites the mode and the publisher overwrites the account state.
   */
  setSeparationEnabled(on: boolean): void;
  /**
   * The cog switch (web parity: `setSeparationEnabledUserAction`, MusicProvider
   * 1871-1876): turning the disclosure off forces the mode back to original.
   * Every USER-driven toggle calls this; nothing else does.
   */
  setSeparationEnabledUserAction(on: boolean): void;
  setVocalVolume(v: number): void;
  setInstrumentalVolume(v: number): void;
  setEqBand(band: keyof EqBands, db: number): void;
  setEqEnabled(on: boolean): void;
  /** True when this build can actually mix two stems (custom blend audible). */
  supportsStemMixing(): boolean;
  /**
   * Re-run the custom-blend reconciliation: the cog's Retry after a stem
   * download or a mixer prepare failed (web parity: `retryStems`). A no-op
   * outside custom mode.
   */
  retryStemBlend(): void;
  /** Logout wipe (FR-10): queue, source, lock screen and store back to boot. */
  resetForLogout(): void;
}

/** Status slice the engine consumes (subset of expo-audio's AudioStatus). */
export interface AudioAdapterStatus {
  currentTime: number;
  duration: number;
  playing: boolean;
  isBuffering: boolean;
  isLoaded: boolean;
  didJustFinish: boolean;
  error: string | null;
}

export type LockScreenMetadata = {
  title?: string;
  artist?: string;
  albumTitle?: string;
  artworkUrl?: string;
};

/**
 * The one audio player the engine owns, behind an adapter so CI runs with a
 * fake. player/expoAudioAdapter.ts implements it over createAudioPlayer().
 */
export interface AudioAdapter {
  readonly currentTime: number;
  readonly duration: number;
  readonly playing: boolean;
  /** Whether a real source is currently loaded (null source = false). */
  readonly hasSource: boolean;
  setVolume(v: number): void;
  play(): void;
  pause(): void;
  /** Replace the source; null clears it. Never point this at /data. */
  replace(uri: string | null): void;
  seekTo(seconds: number): Promise<void>;
  /** Rate with shouldCorrectPitch=false (deliberate pitch shift, FR-64). */
  setRate(rate: number): void;
  onStatus(cb: (s: AudioAdapterStatus) => void): () => void;
  /**
   * WEB-ONLY channel (native adapters never implement it): the browser
   * REJECTED media.play() under its autoplay policy - NotAllowedError, no
   * user gesture on the origin yet. Deliberately NOT status.error: the
   * source is fine and nothing is wedged, so this must never enter the
   * stream-error ladder (it would burn the song's one recovery attempt,
   * then mark-and-advance - a never-clicked tab would walk the whole queue
   * in silence). The engine clears its play intent instead (a stale intent
   * inverts toggle(): the first tap on play would pause), stands the
   * watchdogs down and raises the store's `autoplayBlocked` affordance.
   */
  onAutoplayBlocked?(cb: () => void): () => void;
  setLockScreenActive(active: boolean, metadata?: LockScreenMetadata): void;
  updateLockScreenMetadata(metadata: LockScreenMetadata): void;
  remove(): void;

  // ----- custom blend, additive (DESIGN 16.1 amendment 2026-08-03) ---------
  //
  // Every member below is OPTIONAL, so an adapter with no mixer still
  // satisfies this interface and the frozen 7.3 surface above is untouched.
  // The adapter, not the engine, owns the fan-out: while the stems are
  // active, `play` / `pause` / `seekTo` / `setRate` drive the mixer as well
  // as the muted original, and `replace` (a new main source) always releases
  // the mixer first - stems can never survive a track change.

  /** True while the mixer, not the main player, is producing the audio. */
  readonly stemsActive?: boolean;
  /** Whether a real stem mixer backs this adapter in this build. */
  supportsStems?(): boolean;
  /**
   * Load both LOCAL stem files, mute the main player (gain law: mainGain 0,
   * mixer master = device volume) and start the blend aligned to the main
   * player's current position and play state. Rejects when the mixer cannot
   * open either file; the caller then stays on the plain mix, never a half
   * mix.
   *
   * `passthrough` marks the EQ-only degenerate blend: BOTH uris are the main
   * file and the adapter pins each node to PASSTHROUGH_GAIN (0.5) instead of
   * the user's stem volumes, so the sum stays the original signal and only
   * the EQ in the mixer graph colours it.
   */
  replaceStems?(
    vocalsUri: string,
    instrumentalUri: string,
    opts?: { passthrough?: boolean },
  ): Promise<void>;
  /** Live gain writes, no restart. Remembered while the stems are off. */
  setStemGains?(gains: StemGains): void;
  /** dB per band; the adapter clamps to -12..+12 before it reaches audio. */
  setEqBands?(bands: EqBands): void;
  setEqEnabled?(on: boolean): void;
  /** Stop the stems, release the mixer, restore mainGain = device volume. */
  releaseStems?(): void;
}

/** Listener settings that persist across launches (FR-65). */
export interface PersistedListenerSettings {
  rate: number;
  volume: number;
  separationEnabled: boolean;
  playbackMode: PlaybackMode; // "custom" restores as "original"
  vocalVolume: number;
  instrumentalVolume: number;
  eqLow: number;
  eqMid: number;
  eqHigh: number;
  loopMode: LoopMode;
}

export interface ListenerSettingsPersistence {
  load(): PersistedListenerSettings;
  /** Debounced write of a partial change (250 ms, best-effort). */
  save(patch: Partial<PersistedListenerSettings>): void;
}

/** Everything the engine touches that has I/O behind it, injectable. */
export interface EngineDeps {
  createPlayer(): AudioAdapter;
  /** GET /media/:id/data_url -> presigned URL (single attempt). */
  resolveDataUrl(nodeId: FsNodeId): Promise<string>;
  /** Fire-and-forget POST /play_events. */
  recordPlay(songId: SongId): void;
  persistence: ListenerSettingsPersistence;
  /** Refreshes lock screen metadata for the song the user hears about. */
  onLockScreenUpdate?(song: Song | null): void;
  now?(): number;
}

/** One-shot prefetched URL slot (FR-60). */
export interface PrefetchedUrl {
  songKey: SongKey;
  nodeId: FsNodeId;
  url: string;
  resolvedAt: number;
}
