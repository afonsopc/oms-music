/**
 * Jam manager (FR-113/114/116/117): lifecycle over REST plus the receive-only
 * JamChannel, on top of the hand-rolled CableClient.
 *
 * Deliberately free of react and react-native imports so the whole protocol
 * runs in bun against a FakeCable and a fake follower. The composition root
 * that binds it to the real cable, the engine, the transport and expo-audio
 * is jam/register.ts.
 *
 * Invariants worth stating once:
 * - JOIN BEFORE SUBSCRIBE: the channel rejects non-members, and a rejection
 *   mid-jam means the jam is gone (clear state, never retry-loop);
 * - the channel has ZERO client actions: every mutation is REST;
 * - creating a jam immediately claims the active playback device with a
 *   STEAL, because every jam relay rides the host's PlaybackChannel publishes
 *   (a host with no active device is a silent jam and proposals 400);
 * - there is NO host handoff: a host leaving ends the jam for everyone;
 * - the skip tally is keyed per song id server-side and resets SILENTLY on a
 *   track change - no message announces it, so the local counter clears
 *   whenever the state song id moves.
 */
import type { CableClient, CableSubscription } from "@/cable/types";
import type { JamId, SongId, UserId } from "@/domain/ids";
import type { Jam, JamsIndex, JamState, SkipVoteResult } from "@/domain/jam";
import { JAM_NOTICES, notifyJam, type JamNotice } from "./notices";
import {
  applyJam,
  clearJamState,
  jamStore,
  resetJamStore,
  selectFollowing,
  selectIsHost,
  type JamStoreState,
} from "./store";
import type { FollowerPlayerApi } from "./types";

/** Grace after joining before local playback counts as "the user moved on". */
export const JOIN_GRACE_MS = 1_500;

export type JamRules = {
  queue_mode?: "everyone" | "host";
  skip_mode?: "majority" | "host" | "anyone";
};

/**
 * The jams REST surface, INJECTED so this module imports no api/auth code
 * (which reaches expo-secure-store and react-native) and the whole protocol
 * runs in bun against fakes. register.ts passes api/endpoints/jams.
 */
export interface JamApi {
  getJams(): Promise<JamsIndex>;
  createJam(): Promise<Jam>;
  joinJam(id: JamId): Promise<Jam>;
  leaveJam(id: JamId): Promise<unknown>;
  endJam(id: JamId): Promise<unknown>;
  updateJamRules(id: JamId, rules: JamRules): Promise<Jam>;
  inviteToJam(id: JamId, userId: UserId): Promise<unknown>;
  proposeJamSong(id: JamId, songId: SongId): Promise<unknown>;
  jamSkipVote(id: JamId): Promise<SkipVoteResult>;
}

export interface JamManagerDeps {
  cable: CableClient;
  api: JamApi;
  follower: FollowerPlayerApi;
  /** claim_active { mode: "steal" } on PlaybackChannel (host duty). */
  claimActiveSteal(): void;
  /** Joining as a follower silences local playback first. */
  pauseLocalPlayback(): void;
  /** Refresh the GET /jams caches after every lifecycle change. */
  invalidateJams?(): void;
  notify?(notice: JamNotice): void;
  now?(): number;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : null;

const asJam = (value: unknown): Jam | null => {
  const record = asRecord(value);
  if (!record || typeof record.id !== "number") return null;
  return record as unknown as Jam;
};

const asJamState = (value: unknown): JamState | null => {
  const record = asRecord(value);
  if (!record) return null;
  return record as unknown as JamState;
};

export class JamManager {
  private sub: CableSubscription | null = null;
  /** The jam id the current subscription belongs to. */
  private subscribedJamId: JamId | null = null;
  private started = false;

  constructor(private readonly deps: JamManagerDeps) {}

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  private notify(key: string, params?: Record<string, string | number>): void {
    const notice: JamNotice = params ? { key, params } : { key };
    if (this.deps.notify) this.deps.notify(notice);
    else notifyJam(notice);
  }

  // ----- lifecycle ----------------------------------------------------------

  /** Authed: remember who we are and resume an in-progress jam (FR-113 AC). */
  start(myUserId: UserId): void {
    this.started = true;
    applyJam({ myUserId });
    void this.resume();
  }

  /** Logout / auth loss: drop the subscription and every trace of the jam. */
  stop(): void {
    this.started = false;
    this.unsubscribe();
    this.deps.follower.stop();
    resetJamStore();
  }

  isStarted(): boolean {
    return this.started;
  }

  /** `GET /jams` on app start rediscovers a jam we are still a member of. */
  async resume(): Promise<void> {
    try {
      const index = await this.deps.api.getJams();
      if (!this.started) return;
      if (!index.current) return;
      applyJam({ jam: index.current, joinedAtMs: this.now() });
      this.subscribeToJam(index.current);
    } catch {
      // Offline or a transient failure: the jam resurfaces on the next open.
    }
  }

  // ----- REST actions -------------------------------------------------------

  /**
   * Create + steal the active device in one gesture. `POST /jams` silently
   * leaves (or ends) any previous jam server-side, so no explicit teardown.
   */
  async createJam(): Promise<Jam | null> {
    try {
      const jam = await this.deps.api.createJam();
      this.leaveFollowerAudio();
      applyJam({ jam, state: null, skipVotes: null, joinedAtMs: this.now() });
      this.subscribeToJam(jam);
      // Every jam relay rides the host's playback publishes: starting a jam
      // is a takeover by definition, so the claim is unconditional.
      this.deps.claimActiveSteal();
      this.deps.invalidateJams?.();
      this.notify(JAM_NOTICES.started);
      return jam;
    } catch {
      this.notify(JAM_NOTICES.startFailed);
      return null;
    }
  }

  /** REST join FIRST, then subscribe: the channel rejects non-members. */
  async joinJam(id: JamId): Promise<Jam | null> {
    this.deps.pauseLocalPlayback();
    applyJam({ localPaused: false, joinedAtMs: this.now() });
    try {
      const jam = await this.deps.api.joinJam(id);
      this.leaveFollowerAudio();
      applyJam({ jam, state: null, skipVotes: null, joinedAtMs: this.now() });
      this.subscribeToJam(jam);
      this.deps.invalidateJams?.();
      this.notify(JAM_NOTICES.joined);
      return jam;
    } catch {
      this.notify(JAM_NOTICES.joinFailed);
      return null;
    }
  }

  /** Member leave. A HOST calling this also ends the jam for everyone. */
  async leaveJam(): Promise<void> {
    const jam = jamStore.getState().jam;
    this.clearLocalJam();
    if (!jam) return;
    try {
      await this.deps.api.leaveJam(jam.id);
    } catch {
      // Already gone server-side: local state is already clear.
    }
    this.deps.invalidateJams?.();
  }

  /** Host-only explicit end (`DELETE /jams/:id`). No handoff exists. */
  async endJam(): Promise<void> {
    const jam = jamStore.getState().jam;
    this.clearLocalJam();
    if (!jam) return;
    try {
      await this.deps.api.endJam(jam.id);
    } catch {
      // Ended by someone else already; local state is clear either way.
    }
    this.deps.invalidateJams?.();
  }

  async invite(userId: UserId): Promise<boolean> {
    const jam = jamStore.getState().jam;
    if (!jam) return false;
    try {
      await this.deps.api.inviteToJam(jam.id, userId);
      this.notify(JAM_NOTICES.inviteSent);
      return true;
    } catch {
      this.notify(JAM_NOTICES.inviteFailed);
      return false;
    }
  }

  /** Members propose their OWN songs; the host client does the queueing. */
  async propose(songId: SongId): Promise<void> {
    const jam = jamStore.getState().jam;
    if (!jam) return;
    try {
      await this.deps.api.proposeJamSong(jam.id, songId);
      this.notify(JAM_NOTICES.proposalSent);
    } catch {
      this.notify(JAM_NOTICES.proposalFailed);
    }
  }

  async voteSkip(): Promise<void> {
    const jam = jamStore.getState().jam;
    if (!jam) return;
    try {
      const result = await this.deps.api.jamSkipVote(jam.id);
      // A passed vote fans out `skipped`; only a pending tally is displayed.
      if (!result.skipped) {
        applyJam({ skipVotes: { count: result.count, needed: result.needed } });
      }
    } catch {
      this.notify(JAM_NOTICES.skipVoteFailed);
    }
  }

  async updateRules(rules: {
    queue_mode?: "everyone" | "host";
    skip_mode?: "majority" | "host" | "anyone";
  }): Promise<void> {
    const jam = jamStore.getState().jam;
    if (!jam) return;
    try {
      const updated = await this.deps.api.updateJamRules(jam.id, rules);
      applyJam({ jam: updated });
    } catch {
      this.notify(JAM_NOTICES.rulesFailed);
    }
  }

  // ----- follower controls --------------------------------------------------

  setLocalPaused(paused: boolean): void {
    applyJam({ localPaused: paused });
    this.deps.follower.setLocalPaused(paused);
  }

  toggleLocalPause(): void {
    this.setLocalPaused(!jamStore.getState().localPaused);
  }

  setFollowerVolume(volume: number): void {
    this.deps.follower.setVolume(volume);
  }

  /**
   * Local playback started while following: listening to your own music
   * while following a jam makes no sense, so leave (FR-115). The grace
   * window covers the join itself, whose pause takes a beat to settle.
   */
  onLocalPlaybackStarted(): void {
    const state = jamStore.getState();
    if (!selectFollowing(state)) return;
    if (this.now() - state.joinedAtMs < JOIN_GRACE_MS) return;
    void this.leaveJam();
    this.notify(JAM_NOTICES.leftForLocalPlayback);
  }

  // ----- channel ------------------------------------------------------------

  private subscribeToJam(jam: Jam): void {
    if (this.subscribedJamId === jam.id && this.sub) return;
    this.unsubscribe();
    this.subscribedJamId = jam.id;
    // Key order is byte-stable and echoed verbatim by the server.
    this.sub = this.deps.cable.subscribe(
      { channel: "JamChannel", id: jam.id },
      {
        onMessage: (msg) => this.handleMessage(msg),
        // Rejection = the jam is gone (ended, or we were never a member).
        onReject: () => this.clearLocalJam(),
      },
    );
  }

  private unsubscribe(): void {
    this.sub?.unsubscribe();
    this.sub = null;
    this.subscribedJamId = null;
  }

  private clearLocalJam(): void {
    this.unsubscribe();
    this.leaveFollowerAudio();
    clearJamState();
  }

  private leaveFollowerAudio(): void {
    this.deps.follower.stop();
  }

  private handleMessage(raw: unknown): void {
    const msg = asRecord(raw);
    if (!msg) return;

    switch (msg.type) {
      case "snapshot": {
        // The jam lands first: the host flag below reads the fresh row.
        const jam = asJam(msg.jam);
        if (jam) applyJam({ jam });
        const state = asJamState(msg.state);
        if (state) this.applyState(state, selectIsHost(jamStore.getState()));
        return;
      }
      case "state_changed": {
        const state = asJamState(msg.state);
        if (state) this.applyState(state, selectIsHost(jamStore.getState()));
        return;
      }
      case "position_tick": {
        // The host IS the source: their own ticks are noise to them.
        if (selectIsHost(jamStore.getState())) return;
        const position = Number(msg.position);
        const tick = {
          position: Number.isFinite(position) ? position : 0,
          paused: !!msg.paused,
          songId: msg.song_id == null ? null : String(msg.song_id),
        };
        // A tick that raced a track change describes the PREVIOUS song:
        // dropping it keeps the old position from flashing across the
        // transition (same rule as the controller ticker, FR-109).
        const stateSongId = jamStore.getState().state?.song?.id ?? null;
        if (tick.songId !== null && stateSongId !== null && tick.songId !== String(stateSongId)) {
          return;
        }
        const patched = this.patchStatePosition(tick.position, tick.paused);
        if (patched) applyJam({ state: patched });
        this.deps.follower.applyTick(tick);
        return;
      }
      case "members_changed":
      case "jam_updated": {
        const jam = asJam(msg.jam);
        if (jam) applyJam({ jam });
        return;
      }
      case "song_proposed": {
        const song = asRecord(msg.song);
        const proposer = asRecord(msg.proposer);
        if (!song || !proposer) return;
        this.notify(JAM_NOTICES.songProposed, {
          handle: String(proposer.handle ?? ""),
          title: String(song.title ?? ""),
        });
        return;
      }
      case "skip_votes": {
        applyJam({
          skipVotes: { count: Number(msg.count ?? 0), needed: Number(msg.needed ?? 0) },
        });
        return;
      }
      case "skipped": {
        applyJam({ skipVotes: null });
        this.notify(JAM_NOTICES.songSkipped);
        return;
      }
      case "ended": {
        this.notify(JAM_NOTICES.ended);
        this.clearLocalJam();
        this.deps.invalidateJams?.();
        return;
      }
      default:
        return;
    }
  }

  /** Ticks carry no song payload: patch position/paused onto the last state. */
  private patchStatePosition(position: number, paused: boolean): JamState | null {
    const prev = jamStore.getState().state;
    if (!prev) return null;
    return { ...prev, position, paused };
  }

  private applyState(state: JamState, host: boolean): void {
    // A track change voids the running tally: the server keys votes per song
    // and resets its counter without telling anyone.
    const previousSongId = jamStore.getState().state?.song?.id ?? null;
    const nextSongId = state.song?.id ?? null;
    const patch: Partial<JamStoreState> = { state };
    if (previousSongId !== nextSongId) patch.skipVotes = null;
    applyJam(patch);
    // The host hears their own queue through the engine; only members follow.
    if (host) return;
    this.deps.follower.applyState(state);
  }
}

// ---------------------------------------------------------------------------
// Singleton accessor: the UI talks to the live manager through these free
// functions, so every surface renders inertly before boot wiring runs.
// ---------------------------------------------------------------------------

let current: JamManager | null = null;

export const setJamManager = (manager: JamManager | null): void => {
  current = manager;
};

export const getJamManager = (): JamManager | null => current;

export const jamCreate = (): Promise<Jam | null> =>
  current ? current.createJam() : Promise.resolve(null);

export const jamJoin = (id: JamId): Promise<Jam | null> =>
  current ? current.joinJam(id) : Promise.resolve(null);

export const jamLeave = (): Promise<void> => current?.leaveJam() ?? Promise.resolve();

export const jamEnd = (): Promise<void> => current?.endJam() ?? Promise.resolve();

export const jamInvite = (userId: UserId): Promise<boolean> =>
  current ? current.invite(userId) : Promise.resolve(false);

export const jamPropose = (songId: SongId): Promise<void> =>
  current?.propose(songId) ?? Promise.resolve();

export const jamVoteSkip = (): Promise<void> => current?.voteSkip() ?? Promise.resolve();

export const jamUpdateRules = (rules: {
  queue_mode?: "everyone" | "host";
  skip_mode?: "majority" | "host" | "anyone";
}): Promise<void> => current?.updateRules(rules) ?? Promise.resolve();

export const jamToggleLocalPause = (): void => current?.toggleLocalPause();
