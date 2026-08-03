/**
 * Test doubles for the engine suite (DESIGN 17: services take injected
 * fakes so protocol logic runs in CI without devices).
 */
import type { SongId } from "@/domain/ids";
import type { EqBands, StemGains } from "@/domain/playback";
import type { Song } from "@/domain/song";
import { gainLaw } from "../gainLaw";
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

  // ---- custom blend (mirrors expoAudioAdapter's stem surface) ----
  /** Flip off to model a build with no native mixer. */
  stemMixerAvailable = true;
  /** Set to reject the next replaceStems (unopenable stem file). */
  stemPrepareError: string | null = null;
  /** Held open until release(); the test drives it like a real prepare. */
  stemPrepareGate: (() => void)[] | null = null;
  stemsOn = false;
  stemPair: { vocals: string; instrumental: string } | null = null;
  stemGains: StemGains = { vocal: 1, instrumental: 1 };
  eqBands: EqBands = { low: 0, mid: 0, high: 0 };
  eqEnabled = false;
  masterVolume = 1;
  mixerMaster = 1;
  mixerPlaying = false;
  mixerSeekLog: number[] = [];
  mixerRate = 1;
  stemLog: string[] = [];

  private listeners = new Set<(s: AudioAdapterStatus) => void>();

  get hasSource(): boolean {
    return this.uri !== null;
  }

  get stemsActive(): boolean {
    return this.stemsOn;
  }

  private applyGains(): void {
    const law = gainLaw({
      masterVolume: this.masterVolume,
      stemsActive: this.stemsOn,
      vocalVolume: this.stemGains.vocal,
      instrumentalVolume: this.stemGains.instrumental,
    });
    this.volume = law.mainGain;
    this.mixerMaster = this.stemsOn ? law.master : 1;
  }

  setVolume(v: number): void {
    this.masterVolume = v;
    this.applyGains();
  }

  play(): void {
    if (this.uri === null) return;
    this.playing = true;
    if (this.stemsOn) this.mixerPlaying = true;
    this.emitStatus();
  }

  pause(): void {
    if (this.stemsOn) this.mixerPlaying = false;
    if (!this.playing) return;
    this.playing = false;
    this.emitStatus();
  }

  replace(uri: string | null): void {
    this.releaseStems();
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
    if (this.stemsOn) this.mixerSeekLog.push(seconds);
    this.currentTime = seconds;
    return Promise.resolve();
  }

  setRate(rate: number): void {
    this.rate = rate;
    if (this.stemsOn) this.mixerRate = rate;
  }

  supportsStems(): boolean {
    return this.stemMixerAvailable;
  }

  async replaceStems(vocalsUri: string, instrumentalUri: string): Promise<void> {
    if (!this.stemMixerAvailable) throw new Error("Stem mixer unavailable");
    this.releaseStems();
    if (this.stemPrepareGate) {
      await new Promise<void>((resolve) => this.stemPrepareGate?.push(resolve));
    }
    if (this.stemPrepareError) throw new Error(this.stemPrepareError);
    this.stemsOn = true;
    this.stemPair = { vocals: vocalsUri, instrumental: instrumentalUri };
    this.stemLog.push(`prepare:${vocalsUri}+${instrumentalUri}`);
    this.applyGains();
    this.mixerRate = this.rate;
    this.mixerSeekLog.push(this.currentTime);
    this.mixerPlaying = this.playing;
  }

  setStemGains(gains: StemGains): void {
    this.stemGains = { ...gains };
    this.applyGains();
  }

  setEqBands(bands: EqBands): void {
    this.eqBands = { ...bands };
  }

  setEqEnabled(on: boolean): void {
    this.eqEnabled = on;
  }

  releaseStems(): void {
    if (!this.stemsOn) return;
    this.stemsOn = false;
    this.stemPair = null;
    this.mixerPlaying = false;
    this.stemLog.push("release");
    this.applyGains();
  }

  /** Lets a held replaceStems continue (models a slow native prepare). */
  releasePrepareGate(): void {
    const waiters = this.stemPrepareGate ?? [];
    this.stemPrepareGate = null;
    for (const w of waiters) w();
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
    this.releaseStems();
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
  /** Every persistence patch the engine wrote, in order (FR-65 assertions). */
  saved: Partial<PersistedListenerSettings>[];
} => {
  const player = new FakeAudioPlayer();
  const resolver = makeFakeResolve();
  const recorded: number[] = [];
  const persistence = memoryPersistence();
  const deps: EngineDeps = {
    createPlayer: () => player,
    resolveDataUrl: resolver.resolveDataUrl,
    recordPlay: (songId) => recorded.push(songId),
    persistence,
    ...overrides,
  };
  return { deps, player, resolver, recorded, saved: persistence.saved };
};

/** Drain pending microtasks (async continuations inside the engine). */
export const flush = async (rounds = 25): Promise<void> => {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
};
