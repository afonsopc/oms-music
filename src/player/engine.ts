/**
 * PlayerEngine (DESIGN 7.3/8.1-8.5): one AudioPlayer behind an adapter,
 * JS-owned transitions with generation tokens + loading-song-key guards,
 * pendingSeek applied when metadata lands, the source candidate ladder, the
 * recovery ladder, repeat-one on the ended event, play recording, prefetch,
 * and the zustand store mirror. AudioPlaylist is deliberately NOT used:
 * presigned rotation, the failure ladder, repeat-one-on-ended and jam/remote
 * interception require JS-owned transitions.
 *
 * No I/O module is imported statically: everything native (expo-audio, kv,
 * REST) arrives via EngineDeps so this file runs under bun with fakes.
 */
import type { FsNodeId, SongId, SongKey } from "@/domain/ids";
import { toSongKey } from "@/domain/ids";
import type { EqBands, LoopMode, PlaybackMode, QueueState } from "@/domain/playback";
import type { Song } from "@/domain/song";
import { getPlaybackInterceptor } from "@/contracts/playbackInterceptor";
import { getStemFileProvider } from "@/contracts/stemFiles";
import { getStemMixer } from "@/contracts/stemMixer";
import * as ops from "./queueOps";
import { stemPairNodeIds, wantedNodeId } from "./modes";
import { resolveSources, resolveStemSource, type MainSourceCandidate } from "./sources";
import { PresignedResolver } from "./resolver";
import { RecoveryTracker } from "./recovery";
import { ListenAccumulator } from "./recording";
import { SleepTimer } from "./sleepTimer";
import { playerStore, resetPlayerStore, type StemPhase } from "./store";
import type {
  AudioAdapter,
  AudioAdapterStatus,
  EngineDeps,
  EngineEvent,
  PlayerEngine,
  PlayerEngineExtras,
  SleepTimerSetting,
  TransitionCause,
} from "./types";

/** Prefetch trigger window (FR-60): <= 30 s of the current track remain. */
const PREFETCH_WINDOW_S = 30;
/** Store position slice cadence: 4 Hz max (FR-6 no-interrupt discipline). */
const POSITION_EMIT_MS = 250;
/** expo-audio rate ceiling on both mobile platforms. */
const PLATFORM_MAX_RATE = 2;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

interface CurrentLoad {
  gen: number;
  songKey: SongKey;
  /** Single-file candidates only: the blend is driven by syncStemMode. */
  candidates: MainSourceCandidate[];
  index: number;
  /** True once this load audibly played; gates candidate laddering. */
  audible: boolean;
  /**
   * True once `player.replace()` actually pointed the player at THIS load's
   * candidate. The generation alone is not enough: `beginLoad` bumps it
   * before the presigned-URL round trip, and the player keeps emitting
   * statuses for the OUTGOING source meanwhile (the pause that precedes
   * every swap emits one on both platforms). Consuming pendingSeek on such
   * a status seeks the source that is about to be thrown away, and the new
   * one then starts at 0.
   */
  replaced: boolean;
}

interface TransitionSeed {
  position: number;
  paused: boolean;
}

export class PlayerEngineImpl implements PlayerEngine, PlayerEngineExtras {
  private q: QueueState = ops.emptyQueueState();
  private readonly player: AudioAdapter;
  private readonly resolver: PresignedResolver;
  private readonly recovery: RecoveryTracker;
  private readonly accumulator: ListenAccumulator;
  private readonly sleepTimer: SleepTimer;
  private readonly now: () => number;
  private readonly listeners = new Map<EngineEvent, Set<(payload: unknown) => void>>();

  /** Monotonic token: async continuations bail when a newer transition ran. */
  private transitionGen = 0;
  /** Guards the resolve: a late answer for a skipped song is dropped. */
  private loadingSongKey: SongKey | null = null;
  /** Which fs node the player was last pointed at (null for jam URLs). */
  private requestedNode: { songKey: SongKey; nodeId: FsNodeId | null } | null = null;
  /** Seek applied on the first status with duration > 0 for the current gen. */
  private pendingSeek: number | null = null;
  /** Whether the current song is meant to be audible (survives async gaps). */
  private intendedPlay = false;
  /** Last song id the transition handler processed (same-id re-runs no-op). */
  private lastHandledSongId: SongId | null = null;
  private currentLoad: CurrentLoad | null = null;
  private lastErrorKey: string | null = null;
  /**
   * Monotonic token for the custom blend, bumped by every syncStemMode: a
   * download or a mixer prepare that finishes after the user left custom
   * mode (or skipped the track) must not engage a stale blend.
   */
  private stemGen = 0;
  /** The pair currently loaded in the mixer; a re-sync to it is a no-op. */
  private engagedStems: { vocals: string; instrumental: string } | null = null;
  private prevPlaying = false;
  private lastPositionEmitAt = 0;
  private readonly statusUnsub: () => void;
  /** The mixer's failure channel; inert (a no-op) without a native mixer. */
  private readonly stemStatusUnsub: () => void;
  private disposed = false;

  constructor(private readonly deps: EngineDeps) {
    this.now = deps.now ?? Date.now;
    this.resolver = new PresignedResolver(deps.resolveDataUrl, this.now);
    this.recovery = new RecoveryTracker(this.now);
    this.recovery.setFailedSetListener((keys) => {
      playerStore.setState({ failedSongKeys: new Set(keys) });
    });
    this.accumulator = new ListenAccumulator(deps.recordPlay);
    this.sleepTimer = new SleepTimer(
      () => this.pauseFromSleepTimer(),
      (state) => playerStore.setState({ sleepTimer: state }),
      this.now,
    );

    this.player = deps.createPlayer();
    this.applyPersistedSettings();
    this.statusUnsub = this.player.onStatus((s) => this.onStatus(s));
    // The mixer's own failure channel. While the blend is live the main
    // player is MUTED by the gain law, so a mixer that gives up mid-track
    // would leave NOTHING audible - the one outcome worse than losing the
    // blend. Tearing it down restores mainGain and hands the audio back to
    // the plain mix, exactly as the web keeps the original playing when the
    // stem graph fails (frontend/lib/vocalSeparation.ts:198-204), and the
    // "failed" phase puts Retry in the cog.
    //
    // Subscribed at construction, so player/register.ts installs the native
    // mixer BEFORE it builds the engine (it does; that ordering is also what
    // seeds `stemMixerAvailable`).
    this.stemStatusUnsub = getStemMixer().onStatus((s) => {
      if (s.error === null || !this.engagedStems) return;
      this.stemGen++; // anything still provisioning for this blend is stale
      this.releaseStemBlend("failed");
    });
  }

  /**
   * Listener settings are per DEVICE, not per account (FR-65): the store and
   * the player both start from the persisted values, and the logout wipe
   * re-applies them on top of the reset store.
   */
  private applyPersistedSettings(): void {
    const settings = this.deps.persistence.load();
    playerStore.setState({
      volume: clamp(settings.volume, 0, 1),
      rate: clamp(settings.rate, 0.25, 4),
      loopMode: settings.loopMode,
      playbackMode: settings.playbackMode, // "custom" already restored as "original"
      // A restored stem mode IS separation in use. Publishing
      // `{ playback_mode: "instrumental", separation_enabled: false }` is
      // self-contradictory and the web adopts both raw, so its cog would show
      // separation off while a stem plays.
      separationEnabled: settings.separationEnabled || settings.playbackMode !== "original",
      vocalVolume: clamp(settings.vocalVolume, 0, 1),
      instrumentalVolume: clamp(settings.instrumentalVolume, 0, 1),
      eqLow: clamp(settings.eqLow, -12, 12),
      eqMid: clamp(settings.eqMid, -12, 12),
      eqHigh: clamp(settings.eqHigh, -12, 12),
      stemMixerAvailable: this.supportsStemMixing(),
    });
    this.player.setVolume(clamp(settings.volume, 0, 1));
    this.player.setRate(this.platformRate(settings.rate));
    this.pushStemGains();
    this.pushEqualizer();
  }

  // ----- events -------------------------------------------------------------

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

  private emit(event: EngineEvent, payload?: unknown): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const cb of set) {
      try {
        cb(payload);
      } catch {
        // Listener failures never break playback.
      }
    }
  }

  // ----- accessors ----------------------------------------------------------

  getCurrentSong(): Song | null {
    return ops.currentSongOf(this.q);
  }

  getQueueState(): QueueState {
    return {
      queue: [...this.q.queue],
      queueOrder: [...this.q.queueOrder],
      queueIndex: this.q.queueIndex,
      shuffle: this.q.shuffle,
    };
  }

  /** False while a controller stint holds the player at a null source. */
  hasLoadedSource(): boolean {
    return this.player.hasSource;
  }

  // ----- queue operations ---------------------------------------------------

  setQueue(songs: Song[], startIndex?: number, opts?: { shuffle?: boolean }): void {
    const shuffle = opts?.shuffle ?? this.q.shuffle;
    this.q = ops.setQueue(songs, shuffle, startIndex);
    this.syncQueue();
    this.handleSongTransition("user");
  }

  setQueueIndex(visibleIndex: number): void {
    this.q = ops.setQueueIndex(this.q, visibleIndex);
    this.syncQueue();
    this.handleSongTransition("user");
  }

  setShuffle(on: boolean): void {
    const next = ops.setShuffle(this.q, on);
    if (next === this.q) return;
    this.q = next;
    this.syncQueue();
    // The audible song never changes here (invariant): no transition.
  }

  addToQueue(song: Song): void {
    this.q = ops.addToQueue(this.q, song);
    this.syncQueue();
    // Queue ops are user-driven transitions (playback-core 4.5): appending to
    // a non-empty queue never moves the current song, so the guard inside
    // handleSongTransition makes this a no-op; filling a previously EMPTY
    // queue DOES, and without the transition the store would advertise a
    // current song the player has no source for.
    this.handleSongTransition("user");
  }

  playNext(song: Song): void {
    this.q = ops.playNext(this.q, song);
    this.syncQueue();
    this.handleSongTransition("user");
  }

  insertJamProposal(song: Song): void {
    this.q = ops.insertJamProposal(this.q, song);
    this.syncQueue();
    // jam_song entries are exempt from the follower's interceptor, so "user"
    // here only means "load and play it if the host's queue was empty".
    this.handleSongTransition("user");
  }

  reorderQueue(fromVisible: number, toVisible: number): void {
    const next = ops.reorderQueue(this.q, fromVisible, toVisible);
    if (next === this.q) return;
    this.q = next;
    this.syncQueue();
  }

  removeFromQueue(visibleIndex: number): void {
    const next = ops.removeFromQueue(this.q, visibleIndex);
    if (next === this.q) return;
    this.q = next;
    this.syncQueue();
  }

  patchQueueSong(songId: SongId, patch: Partial<Song>): void {
    const st = this.q;
    const needsUpdate = st.queue.some(
      (s) =>
        s.id === songId &&
        (Object.keys(patch) as (keyof Song)[]).some((key) => s[key] !== patch[key]),
    );
    if (!needsUpdate) return;
    this.q = {
      ...st,
      queue: st.queue.map((s) => (s.id === songId ? { ...s, ...patch } : s)),
    };
    this.syncQueue();
    const current = ops.currentSongOf(this.q);
    if (current && current.id === songId) {
      this.deps.onLockScreenUpdate?.(current);
      this.reconcileModeSource();
      // Separation finishing (or stems being deleted) on the PLAYING song is
      // exactly when the blend becomes possible or impossible.
      this.syncStemMode();
    }
  }

  adoptSnapshot(
    s: QueueState,
    opts: { position: number; paused: boolean; cause: "hydration" | "activation" },
  ): void {
    // Sanitized on EVERY adoption: jam proposals dropped with remap,
    // permutation validated, index clamped.
    this.q = ops.sanitizeSnapshot(s.queue, s.queueOrder, s.queueIndex, s.shuffle);
    this.syncQueue();
    const song = ops.currentSongOf(this.q);
    if (opts.cause === "activation" && song) {
      // The origin device counted (or is counting) this listen.
      this.accumulator.markRecorded(toSongKey(song.id));
    }
    this.handleSongTransition(opts.cause, {
      seed: {
        position: opts.position,
        // Hydration always loads paused; activation honors the remote flag.
        paused: opts.cause === "hydration" ? true : opts.paused,
      },
    });
  }

  // ----- transport ----------------------------------------------------------

  play(): void {
    this.intendedPlay = true;
    this.player.play();
  }

  pause(): void {
    this.intendedPlay = false;
    this.player.pause();
  }

  toggle(): void {
    if (this.player.playing) this.pause();
    else this.play();
  }

  next(cause?: TransitionCause): void {
    this.nextInternal(cause ?? "user", false);
  }

  previous(): void {
    const r = ops.previousIndex(this.q, this.loopMode(), this.player.currentTime);
    if (r.restart) {
      this.seekWithRetry(0);
      return;
    }
    this.q = ops.setQueueIndex(this.q, r.index);
    this.syncQueue();
    this.handleSongTransition("user");
  }

  seek(seconds: number): void {
    const target = Math.max(0, seconds);
    if (this.player.duration > 0) {
      this.seekWithRetry(target);
    } else {
      this.pendingSeek = target;
    }
    playerStore.setState({ position: target });
  }

  setVolume(v: number): void {
    const volume = clamp(v, 0, 1);
    this.player.setVolume(volume);
    playerStore.setState({ volume });
    this.deps.persistence.save({ volume });
  }

  setRate(r: number): void {
    // Store keeps the wire-clamped value (server range 0.25..4) for
    // round-tripping; the platform ceiling applies only to the audio path.
    const rate = clamp(r, 0.25, 4);
    playerStore.setState({ rate });
    this.deps.persistence.save({ rate });
    this.player.setRate(this.platformRate(rate));
  }

  setLoopMode(m: LoopMode): void {
    playerStore.setState({ loopMode: m });
    this.deps.persistence.save({ loopMode: m });
  }

  setPlaybackMode(m: PlaybackMode): void {
    const prev = playerStore.getState().playbackMode;
    if (m === prev) return;
    playerStore.setState({ playbackMode: m });
    this.deps.persistence.save({ playbackMode: m });
    // Any non-original mode IS separation in use: keep the pair this device
    // publishes self-consistent. Adoption applies `separation_enabled` AFTER
    // the mode (remote/adoption.ts), so a remote snapshot still lands verbatim.
    if (m !== "original" && !playerStore.getState().separationEnabled) {
      this.setSeparationEnabled(true);
    }
    const song = ops.currentSongOf(this.q);
    if (!song || song.audio_url) {
      // jam proposals have one source and never blend
      this.syncStemMode();
      return;
    }
    const wanted = wantedNodeId(song, m);
    const req = this.requestedNode;
    if (req && req.songKey === toSongKey(song.id) && req.nodeId === wanted) {
      // Same MAIN file (original <-> custom): never restart it. In custom
      // mode that player keeps running as the muted clock and the lock-screen
      // owner while the mixer takes over the audio, so position and play
      // state are preserved by construction.
      this.syncStemMode();
      return;
    }
    // Different main file: swapSourcePreservingPosition re-syncs the blend
    // once the new source is loaded (see loadCandidate).
    this.swapSourcePreservingPosition();
  }

  setSleepTimer(t: SleepTimerSetting): void {
    this.sleepTimer.set(t);
  }

  playFromIdle(): void {
    const song = ops.currentSongOf(this.q);
    if (this.player.hasSource || !song) {
      this.play();
      return;
    }
    // The source was cleared (controller stint); re-resolve at the last
    // known position, then play.
    const position = playerStore.getState().position;
    this.pendingSeek = position > 0 ? position : null;
    this.intendedPlay = true;
    this.beginLoad(song, { autoplay: true, fresh: false });
  }

  stopAndClearSource(): void {
    this.transitionGen++;
    this.currentLoad = null;
    this.loadingSongKey = null;
    this.requestedNode = null;
    this.pendingSeek = null;
    this.intendedPlay = false;
    this.stemGen++; // any in-flight provisioning is now stale
    this.releaseStemBlend("off");
    this.player.pause();
    this.player.replace(null);
    playerStore.setState({ playing: false, buffering: false });
  }

  // ----- extras (additive; used by WP7/WP9/WP11) ---------------------------

  /**
   * RAW setter, deliberately WITHOUT the force-to-original cascade (web
   * parity: MusicProvider's `setSeparationEnabled`). Remote adoption calls
   * this one, so a snapshot carrying `{ playback_mode: "custom",
   * separation_enabled: false }` lands exactly as it was given instead of
   * being rewritten to `original` and republished over the account state.
   */
  setSeparationEnabled(on: boolean): void {
    if (playerStore.getState().separationEnabled === on) return;
    playerStore.setState({ separationEnabled: on });
    this.deps.persistence.save({ separationEnabled: on });
  }

  /**
   * The cog switch (web parity: `setSeparationEnabledUserAction`). Only a
   * USER turning the disclosure off forces the mode back to original; the
   * cascade lives here and nowhere else.
   */
  setSeparationEnabledUserAction(on: boolean): void {
    this.setSeparationEnabled(on);
    if (!on && playerStore.getState().playbackMode !== "original") {
      this.setPlaybackMode("original");
    }
  }

  setVocalVolume(v: number): void {
    const vocalVolume = clamp(v, 0, 1);
    playerStore.setState({ vocalVolume });
    this.deps.persistence.save({ vocalVolume });
    this.pushStemGains();
  }

  setInstrumentalVolume(v: number): void {
    const instrumentalVolume = clamp(v, 0, 1);
    playerStore.setState({ instrumentalVolume });
    this.deps.persistence.save({ instrumentalVolume });
    this.pushStemGains();
  }

  setEqBand(band: keyof EqBands, db: number): void {
    const value = clamp(db, -12, 12);
    if (band === "low") {
      playerStore.setState({ eqLow: value });
      this.deps.persistence.save({ eqLow: value });
    } else if (band === "mid") {
      playerStore.setState({ eqMid: value });
      this.deps.persistence.save({ eqMid: value });
    } else {
      playerStore.setState({ eqHigh: value });
      this.deps.persistence.save({ eqHigh: value });
    }
    this.pushEqualizer();
  }

  setEqEnabled(on: boolean): void {
    playerStore.setState({ eqEnabled: on }); // session-only, NEVER persisted
    this.pushEqualizer();
  }

  // ----- custom blend (DESIGN 16.1 amendment 2026-08-03) -------------------
  //
  // The main player NEVER stops in custom mode: it stays loaded on the plain
  // mix, muted by the gain law, as the transport clock and the owner of the
  // lock screen / media session, exactly as frontend/lib/vocalSeparation.ts
  // keeps `mainAudio` alive with `mainGain = 0`. Everything below only
  // decides WHEN the mixer owns the audio; the adapter owns the fan-out of
  // play / pause / seek / rate while it does.

  supportsStemMixing(): boolean {
    return this.player.supportsStems?.() ?? false;
  }

  /**
   * The cog's Retry after a stem download or a mixer prepare failed (web
   * parity: `retryStems`). Re-runs the reconciliation from scratch, so a
   * transient WiFi refusal or an unreadable file is recoverable without a
   * track change. A no-op outside custom mode.
   */
  retryStemBlend(): void {
    this.syncStemMode();
  }

  /** The song whose blend should be playing, or null when none should. */
  private stemBlendTarget(): Song | null {
    if (playerStore.getState().playbackMode !== "custom") return null;
    const song = ops.currentSongOf(this.q);
    if (!song || !stemPairNodeIds(song)) return null;
    return song;
  }

  private setStemState(phase: StemPhase, progress = 0): void {
    const st = playerStore.getState();
    if (st.stemPhase === phase && st.stemProgress === progress) return;
    playerStore.setState({ stemPhase: phase, stemProgress: progress });
  }

  /** Tear the mixer down and restore the main gain. Idempotent. */
  private releaseStemBlend(phase: StemPhase): void {
    if (this.engagedStems || this.player.stemsActive) {
      this.engagedStems = null;
      this.player.releaseStems?.();
    }
    this.setStemState(phase);
  }

  /**
   * Reconciles the mixer with (mode, current song, stem files on disk).
   * Called on every mode change, every source load, and whenever stem ids
   * land on the playing song. Bumping stemGen first is what makes a slow
   * download or prepare that finishes AFTER the user moved on inert.
   */
  private syncStemMode(): void {
    const gen = ++this.stemGen;
    const available = this.supportsStemMixing();
    if (playerStore.getState().stemMixerAvailable !== available) {
      playerStore.setState({ stemMixerAvailable: available });
    }

    const song = this.stemBlendTarget();
    if (!song) {
      this.releaseStemBlend("off");
      return;
    }
    if (!available) {
      // No mixer in this build: the plain mix keeps playing and the wire
      // value `custom` still round-trips untouched (DESIGN 15.6).
      this.releaseStemBlend("unsupported");
      return;
    }

    const resident = resolveStemSource(song);
    if (resident) {
      if (
        this.engagedStems &&
        this.engagedStems.vocals === resident.vocals &&
        this.engagedStems.instrumental === resident.instrumental
      ) {
        // Already blending exactly these files: never restart a live mix,
        // just re-assert the live parameters.
        this.pushStemGains();
        this.pushEqualizer();
        this.setStemState("active");
        return;
      }
      void this.engageStemBlend(gen, resident.vocals, resident.instrumental);
      return;
    }

    // Stems not on disk yet. The mixer cannot stream, so the plain mix stays
    // audible while both files download - web parity, where the original
    // keeps playing until BOTH buffers have decoded.
    this.releaseStemBlend("fetching");
    void getStemFileProvider()
      .fetch(song, (fraction) => {
        if (gen !== this.stemGen) return;
        this.setStemState("fetching", clamp(fraction, 0, 1));
      })
      .then((files) => {
        if (gen !== this.stemGen) return;
        return this.engageStemBlend(gen, files.vocalsUri, files.instrumentalUri);
      })
      .catch(() => {
        if (gen !== this.stemGen) return;
        this.setStemState("failed");
      });
  }

  private async engageStemBlend(
    gen: number,
    vocals: string,
    instrumental: string,
  ): Promise<void> {
    const replaceStems = this.player.replaceStems;
    if (!replaceStems) {
      this.releaseStemBlend("unsupported");
      return;
    }
    // `engagedStems` tracks a CONFIRMED live blend only: the adapter drops
    // the previous one inside replaceStems, so holding the old pair across
    // the await would let a concurrent sync skip a re-engage it needs.
    this.engagedStems = null;
    try {
      // The adapter mutes the main player and starts both stems aligned to
      // its clock and play state, so position and play state survive the
      // swap the same way swapSourcePreservingPosition preserves them.
      await replaceStems.call(this.player, vocals, instrumental);
    } catch {
      if (gen !== this.stemGen) return;
      this.engagedStems = null;
      this.setStemState("failed");
      return;
    }
    if (gen !== this.stemGen) {
      // A newer sync (mode change, skip, stems deleted) won the race: undo.
      this.player.releaseStems?.();
      return;
    }
    this.engagedStems = { vocals, instrumental };
    this.pushStemGains();
    this.pushEqualizer();
    this.player.setRate(this.platformRate(playerStore.getState().rate));
    this.setStemState("active");
  }

  /** Live gain writes; remembered by the adapter while the stems are off. */
  private pushStemGains(): void {
    const s = playerStore.getState();
    this.player.setStemGains?.({ vocal: s.vocalVolume, instrumental: s.instrumentalVolume });
  }

  private pushEqualizer(): void {
    const s = playerStore.getState();
    this.player.setEqBands?.({ low: s.eqLow, mid: s.eqMid, high: s.eqHigh });
    this.player.setEqEnabled?.(s.eqEnabled);
  }

  /**
   * Logout wipe (FR-10; DESIGN 5.3 "wipe token, zustand stores, query cache,
   * cable, download scheduler even on failure"). Registered as a logout task
   * by player/register.ts, so it runs on an explicit logout AND on auth loss.
   * A store reset alone is not enough: the queue quartet lives inside the
   * engine and the AudioPlayer keeps its source, so the next user would
   * inherit the previous one's queue, audio and lock screen.
   */
  resetForLogout(): void {
    this.stopAndClearSource();
    this.sleepTimer.set(null);
    this.resolver.reset();
    this.recovery.reset();
    this.accumulator.reset();
    this.q = ops.emptyQueueState();
    this.lastHandledSongId = null;
    this.prevPlaying = false;
    this.lastPositionEmitAt = 0;
    resetPlayerStore();
    // Listener settings belong to the DEVICE, not the account (FR-65): put
    // them back so the store keeps matching what the player actually holds.
    this.applyPersistedSettings();
    this.emit("songChanged", { song: null });
    this.emit("queueChanged", { queueIndex: 0, length: 0 });
    this.deps.onLockScreenUpdate?.(null);
  }

  dispose(): void {
    this.disposed = true;
    this.stemGen++;
    this.releaseStemBlend("off");
    this.statusUnsub();
    this.stemStatusUnsub();
    this.sleepTimer.dispose();
    this.player.remove();
  }

  // ----- transitions --------------------------------------------------------

  private handleSongTransition(
    cause: TransitionCause,
    opts?: { seed?: TransitionSeed; suppressAutoplay?: boolean },
  ): void {
    const song = ops.currentSongOf(this.q);
    const songChanged = (song?.id ?? null) !== this.lastHandledSongId;
    const hasSeed = opts?.seed !== undefined;
    // Same-song re-runs must not restart or autoplay (FR-59) - only a real
    // transition or a seeded adoption proceeds.
    if (!songChanged && !hasSeed) return;
    this.lastHandledSongId = song?.id ?? null;

    if (!song) {
      this.transitionGen++;
      this.currentLoad = null;
      this.loadingSongKey = null;
      this.requestedNode = null;
      this.pendingSeek = null;
      this.intendedPlay = false;
      this.stemGen++;
      this.releaseStemBlend("off");
      this.player.pause();
      this.player.replace(null);
      playerStore.setState({ buffering: false, position: 0, duration: 0 });
      this.emit("songChanged", { song: null });
      this.deps.onLockScreenUpdate?.(null);
      return;
    }

    // A registered interceptor (jam follower) may consume a user-driven
    // transition: the tap becomes a proposal, nothing plays locally.
    if (cause === "user") {
      const interceptor = getPlaybackInterceptor();
      if (interceptor && interceptor(song)) {
        this.intendedPlay = false;
        this.transitionGen++;
        this.currentLoad = null;
        this.loadingSongKey = null;
        this.requestedNode = null;
        this.stemGen++;
        this.releaseStemBlend("off");
        this.player.pause();
        this.player.replace(null);
        playerStore.setState({ buffering: false });
        this.emit("songChanged", { song });
        return;
      }
    }

    // Halt the old track before the swap - otherwise it keeps playing for
    // the whole URL resolve round-trip.
    this.player.pause();
    this.pendingSeek = opts?.seed ? opts.seed.position : null;

    // Autoplay per cause (FR-59): user/auto play; hydration loads paused;
    // activation honors the remote paused flag.
    const autoplay = opts?.suppressAutoplay
      ? false
      : opts?.seed
        ? !opts.seed.paused
        : cause !== "hydration";
    this.intendedPlay = autoplay;

    this.emit("songChanged", { song });
    this.deps.onLockScreenUpdate?.(song);
    this.beginLoad(song, { autoplay, fresh: false });
  }

  /** Point the player at the song's best source (candidate ladder). */
  private beginLoad(song: Song, opts: { autoplay: boolean; fresh: boolean }): void {
    const gen = ++this.transitionGen;
    const key = toSongKey(song.id);
    // A new MAIN source invalidates the blend: stems belong to one song and
    // one file. loadCandidate re-syncs once the new source is in place.
    this.stemGen++;
    this.releaseStemBlend("off");
    const mode = playerStore.getState().playbackMode;
    const resolved = resolveSources(song, mode);
    const candidates = opts.fresh
      ? resolved.candidates.filter((c) => c.kind !== "local")
      : resolved.candidates;
    this.loadingSongKey = key;
    this.requestedNode = { songKey: key, nodeId: resolved.wantedNodeId };
    this.currentLoad = {
      gen,
      songKey: key,
      candidates,
      index: 0,
      audible: false,
      replaced: false,
    };
    this.lastErrorKey = null;
    if (candidates.length === 0) {
      this.markSongFailedAndAdvance(key);
      return;
    }
    playerStore.setState({ buffering: true });
    void this.loadCandidate(gen, opts.autoplay, opts.fresh);
  }

  private async loadCandidate(gen: number, autoplay: boolean, fresh: boolean): Promise<void> {
    const load = this.currentLoad;
    if (!load || load.gen !== gen || gen !== this.transitionGen) return;
    const candidate = load.candidates[load.index];
    if (!candidate) return;

    // Until replace() lands, every status still describes the previous
    // source: no pendingSeek may be consumed against it (see CurrentLoad).
    load.replaced = false;

    let uri: string;
    if (candidate.kind === "network") {
      const prefetched = fresh ? null : this.resolver.takePrefetched(load.songKey, candidate.nodeId);
      if (prefetched) {
        uri = prefetched;
      } else {
        if (fresh) this.resolver.invalidate(candidate.nodeId);
        try {
          uri = await this.resolver.resolve(candidate.nodeId, { fresh });
        } catch {
          if (gen !== this.transitionGen || this.loadingSongKey !== load.songKey) return;
          if (load.index < load.candidates.length - 1) {
            load.index++;
            void this.loadCandidate(gen, autoplay, fresh);
            return;
          }
          // URL resolve failed (both attempts): mark and advance (FR-61).
          this.markSongFailedAndAdvance(load.songKey);
          return;
        }
        // A late answer for a song the user already skipped is dropped.
        if (gen !== this.transitionGen || this.loadingSongKey !== load.songKey) return;
      }
    } else {
      uri = candidate.uri;
    }

    this.lastErrorKey = null;
    this.player.replace(uri);
    load.replaced = true;
    this.player.setRate(this.platformRate(playerStore.getState().rate));
    if (autoplay) {
      this.intendedPlay = true;
      this.player.play();
    }
    // The muted clock is in place: bring the blend back if custom mode wants
    // one for this song (track change, mode swap, recovery reload).
    this.syncStemMode();
  }

  /** Mode switches and stem reconciliation preserve position + play state. */
  private swapSourcePreservingPosition(): void {
    const song = ops.currentSongOf(this.q);
    if (!song) return;
    const wasPlaying = this.player.playing || this.intendedPlay;
    const position = this.player.currentTime;
    this.player.pause();
    this.pendingSeek = position > 0 ? position : null;
    this.intendedPlay = wasPlaying;
    this.beginLoad(song, { autoplay: wasPlaying, fresh: false });
  }

  /**
   * Stale-queue reconciliation (FR-68): swap to the stem file when the ids
   * land, and back to the plain mix when they go away.
   *
   * `wantedNodeId`, not `stemNodeIdForMode`: the latter answers null once the
   * stems are deleted, and returning on that left the player streaming a file
   * the backend had just destroyed while the cog still showed the stem mode
   * selected. The plain-mix fallback is the documented rule for a stem mode
   * with no stem, and DELETING stems is now one tap away in the cog.
   */
  private reconcileModeSource(): void {
    const mode = playerStore.getState().playbackMode;
    if (mode !== "instrumental" && mode !== "vocals") return;
    const song = ops.currentSongOf(this.q);
    if (!song || song.audio_url) return;
    const wanted = wantedNodeId(song, mode);
    if (!wanted) return;
    const req = this.requestedNode;
    if (!req || req.songKey !== toSongKey(song.id)) return;
    if (req.nodeId === wanted) return; // already on the right file
    this.swapSourcePreservingPosition();
  }

  private nextInternal(cause: TransitionCause, suppressAutoplay: boolean): void {
    const r = ops.nextIndex(this.q, this.loopMode());
    if (!r) return;
    if (r.restart) {
      // Loop All wrapped onto the same entry (single-song queue): a state
      // no-op would dead-end playback, so restart the source directly. Same
      // ordering rule as repeat-one - play() only after the rewind lands,
      // or it asks a player parked at the end of the track to play.
      if (suppressAutoplay) {
        void this.seekWithRetry(0);
        return;
      }
      this.intendedPlay = true;
      void this.seekWithRetry(0).then(() => {
        if (this.intendedPlay) this.player.play();
      });
      return;
    }
    if (r.index === this.q.queueIndex) return; // clamped at the end
    this.q = ops.setQueueIndex(this.q, r.index);
    this.syncQueue();
    this.handleSongTransition(cause, { suppressAutoplay });
  }

  // ----- ended / loop (FR-58) ----------------------------------------------

  private handleEnded(): void {
    const song = ops.currentSongOf(this.q);
    // Natural end: reset the accumulator so a replay counts again.
    this.accumulator.resetOnEnded();
    this.emit("ended", { songKey: song ? toSongKey(song.id) : null });
    // End-of-song sleep timer: pauses now and suppresses the autoplay of
    // whatever the loop logic lines up next.
    const sleepFired = this.sleepTimer.consumeEndOfSong();
    if (this.loopMode() === "one") {
      // Repeat-one on the ended event, NEVER a native loop flag: ended must
      // keep firing for the sleep timer and the accumulator reset.
      //
      // play() must wait for the rewind to LAND. Fired straight after the
      // seek it asked a player still sitting at the end of the track to
      // play, which does nothing, so repeat-one simply stopped at the end of
      // every song.
      if (sleepFired) {
        void this.seekWithRetry(0);
        return;
      }
      this.intendedPlay = true;
      void this.seekWithRetry(0).then(() => {
        if (this.intendedPlay) this.player.play();
      });
      return;
    }
    this.nextInternal("auto", sleepFired);
  }

  private pauseFromSleepTimer(): void {
    this.pause();
  }

  // ----- failure recovery (FR-61) ------------------------------------------

  private handlePlayerError(): void {
    const load = this.currentLoad;
    if (load && !load.audible && load.gen === this.transitionGen) {
      // Candidate error BEFORE audiblePlaying: move to the next candidate
      // silently (the FLAC-on-iOS local decode case), not into the ladder.
      if (load.index < load.candidates.length - 1) {
        load.index++;
        void this.loadCandidate(load.gen, this.intendedPlay, false);
        return;
      }
    }
    this.handleStreamError();
  }

  private handleStreamError(): void {
    const song = ops.currentSongOf(this.q);
    if (!song) return;
    const key = toSongKey(song.id);
    this.emit("streamError", { songKey: key });
    if (this.recovery.beginRecoveryAttempt(key)) {
      // First failure: remember the position, mint a genuinely fresh URL,
      // reload, resume when the song was meant to be audible.
      const position = this.player.currentTime;
      if (position > 0) this.pendingSeek = position;
      const resume =
        playerStore.getState().playing || this.player.playing || this.intendedPlay;
      this.intendedPlay = resume;
      this.beginLoad(song, { autoplay: resume, fresh: true });
      return;
    }
    this.markSongFailedAndAdvance(key);
  }

  private markSongFailedAndAdvance(failedKey: SongKey): void {
    playerStore.setState({ buffering: false });
    this.recovery.markFailed(failedKey); // throttled toast lives inside
    const st = this.q;
    let index = st.queueIndex + 1;
    if (index >= st.queueOrder.length) {
      if (this.loopMode() !== "all") return;
      index = 0;
    }
    if (index === st.queueIndex) return;
    const upcoming = st.queue[st.queueOrder[index]!];
    // Stop the chain when the next entry already failed: advancing would
    // just loop the failure chain through a dead queue.
    if (upcoming && this.recovery.hasFailed(toSongKey(upcoming.id))) return;
    this.q = ops.setQueueIndex(st, index);
    this.syncQueue();
    this.handleSongTransition("auto");
  }

  // ----- status pump --------------------------------------------------------

  private onStatus(s: AudioAdapterStatus): void {
    if (this.disposed) return;
    const load = this.currentLoad;

    if (s.error) {
      const errorKey = `${this.transitionGen}:${load?.index ?? -1}`;
      if (this.lastErrorKey !== errorKey) {
        this.lastErrorKey = errorKey;
        this.handlePlayerError();
      }
      return;
    }

    if (s.didJustFinish) {
      this.prevPlaying = s.playing;
      playerStore.setState({ playing: s.playing, buffering: false });
      this.handleEnded();
      return;
    }

    // pendingSeek applies on the first status with a finite duration for
    // the current generation AND the source it actually describes (seeks
    // before metadata are dropped natively; see CurrentLoad.replaced).
    if (
      this.pendingSeek !== null &&
      s.isLoaded &&
      s.duration > 0 &&
      load &&
      load.replaced &&
      load.gen === this.transitionGen
    ) {
      const target = Math.min(this.pendingSeek, s.duration);
      this.pendingSeek = null;
      this.seekWithRetry(target);
      playerStore.setState({ position: target, duration: s.duration });
    }

    // Audible acceptance: the candidate is good; the song is proven again.
    if (s.playing && s.isLoaded && !s.isBuffering) {
      const song = ops.currentSongOf(this.q);
      if (song) this.recovery.clearFailed(toSongKey(song.id));
      if (load && !load.audible && load.gen === this.transitionGen) {
        load.audible = true;
        this.emit("audiblePlaying", { songKey: load.songKey });
      }
    }

    // Play-state flips: mirror + detect external pauses (interruptions,
    // native lock-screen pause) so recovery never force-resumes them.
    if (s.playing !== this.prevPlaying) {
      this.prevPlaying = s.playing;
      playerStore.setState({ playing: s.playing });
      if (!s.playing && this.intendedPlay && load?.audible) {
        this.intendedPlay = false; // interruption: never auto-resume
      }
      this.emit("playStateChanged", { playing: s.playing });
      this.deps.onLockScreenUpdate?.(ops.currentSongOf(this.q));
    }

    // While a load is in flight and its candidate has not been handed to the
    // player yet, every status still describes the OUTGOING (paused, fully
    // buffered) source, whose `isBuffering: false` would clear the flag
    // beginLoad just raised. The web keeps `buffering` true from reloadSrc
    // until `canplay`, i.e. across exactly this resolve + first-byte window.
    const loadInFlight = !!load && load.gen === this.transitionGen && !load.replaced;
    if (!loadInFlight && playerStore.getState().buffering !== s.isBuffering) {
      playerStore.setState({ buffering: s.isBuffering });
    }

    // Listen accumulator (FR-62): forward deltas only; jam songs skipped.
    this.accumulator.onTime(ops.currentSongOf(this.q), s.currentTime, s.duration);

    // Prefetch the upcoming track near the end of this one (FR-60).
    if (s.duration > 0 && s.duration - s.currentTime <= PREFETCH_WINDOW_S) {
      this.maybePrefetchNext();
    }

    // 4 Hz position slice.
    const at = this.now();
    if (at - this.lastPositionEmitAt >= POSITION_EMIT_MS) {
      this.lastPositionEmitAt = at;
      playerStore.setState({
        position: s.currentTime,
        duration: Number.isFinite(s.duration) ? s.duration : 0,
      });
      this.emit("status", {
        position: s.currentTime,
        duration: s.duration,
        playing: s.playing,
        buffering: s.isBuffering,
      });
    }
  }

  // ----- prefetch (FR-60) ---------------------------------------------------

  private maybePrefetchNext(): void {
    const loop = this.loopMode();
    if (loop === "one") return;
    const st = this.q;
    let index = st.queueIndex + 1;
    if (index >= st.queueOrder.length) {
      if (loop !== "all") return;
      index = 0;
    }
    if (index === st.queueIndex) return;
    const upcoming = st.queue[st.queueOrder[index]!];
    if (!upcoming || upcoming.audio_url) return; // jam songs never prefetch
    const key = toSongKey(upcoming.id);
    if (this.recovery.hasFailed(key)) return;
    const mode = playerStore.getState().playbackMode;
    const resolved = resolveSources(upcoming, mode);
    if (!resolved.wantedNodeId) return;
    // A local file will play: no network resolve needed.
    if (resolved.candidates[0]?.kind !== "network") return;
    this.resolver.prefetch(key, resolved.wantedNodeId);
  }

  // ----- helpers ------------------------------------------------------------

  private loopMode(): LoopMode {
    return playerStore.getState().loopMode;
  }

  private platformRate(rate: number): number {
    return clamp(rate, 0.25, PLATFORM_MAX_RATE);
  }

  /** Resolves once the seek has landed (or all three attempts failed). */
  private seekWithRetry(seconds: number): Promise<void> {
    return this.player
      .seekTo(seconds)
      .catch(() => this.player.seekTo(seconds))
      .catch(() => this.player.seekTo(seconds))
      .catch(() => undefined);
  }

  private syncQueue(): void {
    playerStore.setState({
      queue: this.q.queue,
      queueOrder: this.q.queueOrder,
      queueIndex: this.q.queueIndex,
      shuffle: this.q.shuffle,
      currentSong: ops.currentSongOf(this.q),
    });
    this.emit("queueChanged", {
      queueIndex: this.q.queueIndex,
      length: this.q.queue.length,
    });
  }
}
