/**
 * Player engine public contract (DESIGN.md 7.3, frozen after WP3 review) plus
 * the injectable dependency seams that keep the engine unit-testable in bun
 * (FakeAudioPlayer in CI, expo-audio on device via player/register.ts).
 */
import type { SongId, SongKey, FsNodeId } from "@/domain/ids";
import type { LoopMode, PlaybackMode, QueueState } from "@/domain/playback";
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
  insertJamProposal(song: Song): void;
  setSeparationEnabled(on: boolean): void;
  setVocalVolume(v: number): void;
  setInstrumentalVolume(v: number): void;
  setEqBand(band: "low" | "mid" | "high", db: number): void;
  setEqEnabled(on: boolean): void;
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
  setLockScreenActive(active: boolean, metadata?: LockScreenMetadata): void;
  updateLockScreenMetadata(metadata: LockScreenMetadata): void;
  remove(): void;
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
  /** GET /fs_nodes/:id/data_url -> presigned URL (single attempt). */
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
