/**
 * Test doubles for the remote suite (DESIGN 17: protocol logic runs in CI
 * without devices). FakeCable records every frame the channel sends and
 * lets a test push server frames back in; FakeEngine records the engine
 * calls the role machine makes.
 */
import type {
  CableClient,
  CableState,
  CableSubscription,
  CableSubscriptionHandlers,
} from "@/cable/types";
import type { SongId } from "@/domain/ids";
import type { LoopMode, PlaybackMode, PlaybackSnapshot, QueueState } from "@/domain/playback";
import type { Song } from "@/domain/song";
import type { PlayerStoreState } from "@/player/store";
import type { EngineEvent } from "@/player/types";
import type { LocalPlaybackState, RemoteEngine } from "../localPlayer";

export const fakeSong = (id: number, over: Partial<Song> = {}): Song =>
  ({
    id: id as SongId,
    title: `Song ${id}`,
    album: null,
    duration: 180,
    artists: [],
    ...over,
  }) as unknown as Song;

export interface SentFrame {
  action: string;
  data?: Record<string, unknown>;
}

export class FakeCable implements CableClient {
  readonly sent: SentFrame[] = [];
  handlers: CableSubscriptionHandlers | null = null;
  params: Record<string, unknown> | null = null;
  wakeHook: (() => void) | null = null;
  unsubscribed = false;
  connectedWith: string | null = null;
  foregrounds = 0;
  private stateListeners = new Set<(s: CableState) => void>();

  connect(token: string): void {
    this.connectedWith = token;
  }

  disconnect(): void {
    this.connectedWith = null;
  }

  subscribe(
    channelParams: Record<string, unknown>,
    handlers: CableSubscriptionHandlers,
  ): CableSubscription {
    this.params = channelParams;
    this.handlers = handlers;
    const sub: CableSubscription = {
      perform: (action, data) => {
        this.sent.push({ action, data });
      },
      unsubscribe: () => {
        this.unsubscribed = true;
      },
      setWakeHook: (fn) => {
        this.wakeHook = fn;
      },
    };
    return sub;
  }

  onStateChange(cb: (s: CableState) => void): () => void {
    this.stateListeners.add(cb);
    return () => {
      this.stateListeners.delete(cb);
    };
  }

  notifyForeground(): void {
    this.foregrounds += 1;
    this.wakeHook?.();
  }

  // ----- test helpers -------------------------------------------------------

  emitState(state: CableState): void {
    for (const cb of this.stateListeners) cb(state);
  }

  push(message: Record<string, unknown>): void {
    this.handlers?.onMessage(message);
  }

  confirm(): void {
    this.handlers?.onConfirm?.();
  }

  reject(): void {
    this.handlers?.onReject?.();
  }

  actions(): string[] {
    return this.sent.map((f) => f.action);
  }

  last(action: string): SentFrame | undefined {
    return [...this.sent].reverse().find((f) => f.action === action);
  }
}

export class FakeEngine implements RemoteEngine {
  queueState: QueueState = { queue: [], queueOrder: [], queueIndex: 0, shuffle: false };
  readonly calls: string[] = [];
  adopted: { state: QueueState; position: number; paused: boolean; cause: string } | null = null;
  loopMode: LoopMode = "all";
  rate = 1;
  mode: PlaybackMode = "original";
  volume = 1;
  private listeners = new Map<EngineEvent, Set<(payload: unknown) => void>>();

  private record(name: string): void {
    this.calls.push(name);
  }

  setQueue(songs: Song[]): void {
    this.record("setQueue");
    this.queueState = {
      queue: songs,
      queueOrder: songs.map((_, i) => i),
      queueIndex: 0,
      shuffle: false,
    };
  }
  setQueueIndex(): void {
    this.record("setQueueIndex");
  }
  setShuffle(): void {
    this.record("setShuffle");
  }
  addToQueue(): void {
    this.record("addToQueue");
  }
  playNext(): void {
    this.record("playNext");
  }
  reorderQueue(): void {
    this.record("reorderQueue");
  }
  removeFromQueue(): void {
    this.record("removeFromQueue");
  }
  patchQueueSong(): void {
    this.record("patchQueueSong");
  }
  adoptSnapshot(
    s: QueueState,
    opts: { position: number; paused: boolean; cause: "hydration" | "activation" },
  ): void {
    this.record(`adoptSnapshot:${opts.cause}`);
    this.queueState = s;
    this.adopted = { state: s, position: opts.position, paused: opts.paused, cause: opts.cause };
  }
  play(): void {
    this.record("play");
  }
  pause(): void {
    this.record("pause");
  }
  toggle(): void {
    this.record("toggle");
  }
  next(): void {
    this.record("next");
  }
  previous(): void {
    this.record("previous");
  }
  seek(): void {
    this.record("seek");
  }
  setVolume(v: number): void {
    this.record("setVolume");
    this.volume = v;
  }
  setRate(r: number): void {
    this.record("setRate");
    this.rate = r;
  }
  setLoopMode(m: LoopMode): void {
    this.record("setLoopMode");
    this.loopMode = m;
  }
  setPlaybackMode(m: PlaybackMode): void {
    this.record("setPlaybackMode");
    this.mode = m;
  }
  setSleepTimer(): void {
    this.record("setSleepTimer");
  }
  playFromIdle(): void {
    this.record("playFromIdle");
  }
  stopAndClearSource(): void {
    this.record("stopAndClearSource");
  }
  on(event: EngineEvent, cb: (payload: unknown) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(cb);
    return () => {
      set.delete(cb);
    };
  }
  emit(event: EngineEvent, payload?: unknown): void {
    for (const cb of this.listeners.get(event) ?? []) cb(payload);
  }
  // extras
  getCurrentSong(): Song | null {
    const backing = this.queueState.queueOrder[this.queueState.queueIndex];
    return backing === undefined ? null : (this.queueState.queue[backing] ?? null);
  }
  getQueueState(): QueueState {
    return this.queueState;
  }
  insertJamProposal(): void {
    this.record("insertJamProposal");
  }
  setSeparationEnabled(): void {
    this.record("setSeparationEnabled");
  }
  setVocalVolume(): void {
    this.record("setVocalVolume");
  }
  setInstrumentalVolume(): void {
    this.record("setInstrumentalVolume");
  }
  setEqBand(): void {
    this.record("setEqBand");
  }
  setEqEnabled(): void {
    this.record("setEqEnabled");
  }
}

export class FakeLocalState implements LocalPlaybackState {
  private state: PlayerStoreState;
  private readonly listeners = new Set<(s: PlayerStoreState, p: PlayerStoreState) => void>();

  constructor(initial: Partial<PlayerStoreState> = {}) {
    this.state = {
      queue: [],
      queueOrder: [],
      queueIndex: 0,
      shuffle: false,
      currentSong: null,
      position: 0,
      duration: 0,
      playing: false,
      buffering: false,
      loopMode: "all",
      volume: 1,
      rate: 1,
      playbackMode: "original",
      separationEnabled: false,
      vocalVolume: 1,
      instrumentalVolume: 1,
      eqLow: 0,
      eqMid: 0,
      eqHigh: 0,
      eqEnabled: false,
      sleepTimer: null,
      failedSongKeys: new Set(),
      ...initial,
    };
  }

  getState(): PlayerStoreState {
    return this.state;
  }

  subscribe(cb: (s: PlayerStoreState, p: PlayerStoreState) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  set(patch: Partial<PlayerStoreState>): void {
    const prev = this.state;
    this.state = { ...prev, ...patch };
    for (const cb of this.listeners) cb(this.state, prev);
  }
}

export const wireSnapshot = (over: Partial<PlaybackSnapshot> = {}): PlaybackSnapshot => ({
  active_device_id: null,
  song_id: "1",
  position: 0,
  paused: true,
  queue: ["1", "2"],
  queue_index: 0,
  queue_order: [0, 1],
  loop_mode: "all",
  shuffle: false,
  volume: 1,
  queue_songs: [fakeSong(1), fakeSong(2)],
  ...over,
});
