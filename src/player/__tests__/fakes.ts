/**
 * Test doubles for the engine suite (DESIGN 17: services take injected
 * fakes so protocol logic runs in CI without devices).
 */
import type { SongId } from "@/domain/ids";
import type { Song } from "@/domain/song";
import type {
  AudioAdapter,
  AudioAdapterStatus,
  EngineDeps,
  ListenerSettingsPersistence,
  LockScreenMetadata,
  PersistedListenerSettings,
} from "../types";

export const makeSong = (id: number, overrides: Partial<Song> = {}): Song =>
  ({
    id: id as SongId,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    title: `Song ${id}`,
    album: null,
    duration: 200,
    position: null,
    year: null,
    audio_fs_node_id: `audio-${id}`,
    compressed_audio_fs_node_id: `compressed-${id}`,
    artwork_fs_node_id: null,
    compressed_artwork_fs_node_id: null,
    vocals_fs_node_id: null,
    instrumental_fs_node_id: null,
    vocal_separation_started_at: null,
    user_id: "user-1",
    source_kind: null,
    source_provider: null,
    source_url: null,
    source_id: null,
    isrc: null,
    original_filename: null,
    audio_codec: null,
    audio_bitrate_kbps: null,
    audio_sample_rate_hz: null,
    audio_channels: null,
    audio_lossless: null,
    audio_filesize_bytes: null,
    artists: [],
    ...overrides,
  }) as Song;

export class FakeAudioPlayer implements AudioAdapter {
  uri: string | null = null;
  currentTime = 0;
  duration = 0;
  playing = false;
  volume = 1;
  rate = 1;
  loaded = false;
  buffering = false;
  error: string | null = null;
  removed = false;
  lockScreenActive = false;
  lockScreenMetadata: LockScreenMetadata | undefined;
  seekLog: number[] = [];
  replaceLog: (string | null)[] = [];
  /**
   * Native adapters deliver status updates asynchronously (iOS through the
   * periodic time observer, Android through onIsPlayingChanged), so a status
   * caused by `pause()` lands a tick AFTER the caller's next statement. The
   * default here is synchronous, which hides ordering bugs; flip this on to
   * reproduce the real delivery order.
   */
  asyncStatus = false;

  private listeners = new Set<(s: AudioAdapterStatus) => void>();

  get hasSource(): boolean {
    return this.uri !== null;
  }

  setVolume(v: number): void {
    this.volume = v;
  }

  play(): void {
    if (this.uri === null) return;
    this.playing = true;
    this.emitStatus();
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    this.emitStatus();
  }

  replace(uri: string | null): void {
    this.uri = uri;
    this.replaceLog.push(uri);
    this.currentTime = 0;
    this.duration = 0;
    this.loaded = false;
    this.playing = false;
    this.error = null;
  }

  seekTo(seconds: number): Promise<void> {
    this.seekLog.push(seconds);
    this.currentTime = seconds;
    return Promise.resolve();
  }

  setRate(rate: number): void {
    this.rate = rate;
  }

  onStatus(cb: (s: AudioAdapterStatus) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  setLockScreenActive(active: boolean, metadata?: LockScreenMetadata): void {
    this.lockScreenActive = active;
    this.lockScreenMetadata = metadata;
  }

  updateLockScreenMetadata(metadata: LockScreenMetadata): void {
    this.lockScreenMetadata = metadata;
  }

  remove(): void {
    this.removed = true;
  }

  // ---- test drivers ----

  /** Metadata loaded: duration known; emits a status. */
  emitLoaded(duration: number): void {
    this.duration = duration;
    this.loaded = true;
    this.emitStatus();
  }

  /** Advance the clock while playing; emits a status per call. */
  tick(dt: number): void {
    if (this.playing) this.currentTime += dt;
    this.emitStatus();
  }

  emitError(message: string): void {
    this.error = message;
    this.playing = false;
    this.emitStatus();
    this.error = null;
  }

  emitEnded(): void {
    this.playing = false;
    const status = this.buildStatus();
    status.didJustFinish = true;
    for (const cb of [...this.listeners]) cb(status);
  }

  emitStatus(): void {
    const status = this.buildStatus();
    const deliver = (): void => {
      for (const cb of [...this.listeners]) cb(status);
    };
    if (this.asyncStatus) void Promise.resolve().then(deliver);
    else deliver();
  }

  private buildStatus(): AudioAdapterStatus {
    return {
      currentTime: this.currentTime,
      duration: this.duration,
      playing: this.playing,
      isBuffering: this.buffering,
      isLoaded: this.loaded,
      didJustFinish: false,
      error: this.error,
    };
  }
}

export const defaultSettings = (): PersistedListenerSettings => ({
  rate: 1,
  volume: 1,
  separationEnabled: false,
  playbackMode: "original",
  vocalVolume: 1,
  instrumentalVolume: 1,
  eqLow: 0,
  eqMid: 0,
  eqHigh: 0,
  loopMode: "all",
});

export const memoryPersistence = (
  initial: PersistedListenerSettings = defaultSettings(),
): ListenerSettingsPersistence & { saved: Partial<PersistedListenerSettings>[] } => {
  const saved: Partial<PersistedListenerSettings>[] = [];
  return {
    saved,
    load: () => initial,
    save: (patch) => {
      saved.push(patch);
    },
  };
};

export interface FakeResolverControl {
  calls: string[];
  /** nodeId -> url; a missing entry rejects. */
  urls: Map<string, string>;
  /** nodeIds whose resolution is held until release() is called. */
  hold: Set<string>;
  release(nodeId: string): void;
}

export const makeFakeResolve = (): {
  control: FakeResolverControl;
  resolveDataUrl: (nodeId: string) => Promise<string>;
} => {
  const pending = new Map<string, (() => void)[]>();
  const control: FakeResolverControl = {
    calls: [],
    urls: new Map(),
    hold: new Set(),
    release(nodeId: string) {
      const waiters = pending.get(nodeId) ?? [];
      pending.delete(nodeId);
      for (const w of waiters) w();
    },
  };
  const resolveDataUrl = async (nodeId: string): Promise<string> => {
    control.calls.push(nodeId);
    if (control.hold.has(nodeId)) {
      await new Promise<void>((resolve) => {
        const list = pending.get(nodeId) ?? [];
        list.push(resolve);
        pending.set(nodeId, list);
      });
    }
    const url = control.urls.get(nodeId);
    if (url === undefined) throw new Error(`no url for ${nodeId}`);
    // Every resolve mints a DIFFERENT presigned URL.
    return `${url}?sig=${control.calls.length}`;
  };
  return { control, resolveDataUrl };
};

export const makeEngineDeps = (
  overrides: Partial<EngineDeps> = {},
): {
  deps: EngineDeps;
  player: FakeAudioPlayer;
  resolver: ReturnType<typeof makeFakeResolve>;
  recorded: number[];
} => {
  const player = new FakeAudioPlayer();
  const resolver = makeFakeResolve();
  const recorded: number[] = [];
  const deps: EngineDeps = {
    createPlayer: () => player,
    resolveDataUrl: resolver.resolveDataUrl,
    recordPlay: (songId) => recorded.push(songId),
    persistence: memoryPersistence(),
    ...overrides,
  };
  return { deps, player, resolver, recorded };
};

/** Drain pending microtasks (async continuations inside the engine). */
export const flush = async (rounds = 25): Promise<void> => {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
};
