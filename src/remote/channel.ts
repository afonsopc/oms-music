/**
 * PlaybackChannel manager (FR-106..112; DESIGN 10.2): presence, the role
 * machine, snapshot adoption, controller mirroring, active publishing and
 * the command router, all over the hand-rolled CableClient.
 *
 * Deliberately free of react and react-native imports so the whole protocol
 * runs in bun against a FakeCable + FakeEngine (DESIGN 17). The composition
 * root that binds it to the real engine, cable, lock screen and AppState is
 * remote/register.ts.
 *
 * Invariants worth stating once:
 * - exactly one audible device: becoming a controller force-pauses and
 *   CLEARS the local source (FR-107); becoming active adopts the snapshot;
 * - `steal` claims adopt activeness optimistically (a takeover must play
 *   now), `if_none` claims stay pessimistic until the server confirms and
 *   demote on `claim_rejected` (DESIGN 10.5);
 * - a local takeover (setQueue on a non-active device) and a self-initiated
 *   if_none claim must NOT re-adopt the snapshot on promotion: they are
 *   already playing what the user asked for;
 * - a cable blip while active never pauses local audio: the reconnect
 *   snapshot steals activeness back and force-publishes truth (FR-112).
 */
import type { CableClient, CableSubscription } from "@/cable/types";
import type { PlaybackDevice, PlaybackSnapshot } from "@/domain/playback";
import type { Song } from "@/domain/song";
import { adoptForActivation, adoptForHydration, hasAdoptableQueue } from "./adoption";
import { executeRemoteCommand } from "./commands";
import {
  ControllerTicker,
  STALE_TICK_MS,
  tickFromSnapshot,
  type PositionTick,
} from "./controller";
import type { LocalPlaybackState, RemoteEngine } from "./localPlayer";
import { ActivePublisher } from "./publisher";
import { mergeSlimState, normalizeWireSongId, snapshotCurrentSong } from "./snapshot";
import {
  applyRemote,
  deviceDisplayLabel,
  remoteStore,
  resetRemoteStore,
  type RemoteRole,
} from "./store";

/** Registry rows expire after 75 s server-side; 20 s survives throttling. */
const HEARTBEAT_INTERVAL_MS = 20_000;
/**
 * Activation watchdog: a transfer that resumes PLAYING audio suppresses
 * publishes until the first audible status. Native has no autoplay policy,
 * but an audio session can still be refused (a call in progress, another
 * app holding exclusive output). When the window elapses with no audible
 * frame we map it to `activation_blocked` exactly like the web's
 * NotAllowedError branch: every device shows "needs a tap on <device>" and
 * this device never publishes the phantom paused:true.
 */
const ACTIVATION_TIMEOUT_MS = 10_000;

export type ClaimMode = "if_none" | "steal";

export type RemoteNotice =
  | { kind: "no_active_device" }
  | { kind: "device_needs_tap"; deviceLabel: string }
  /**
   * A `transfer` the server refused - almost always `device_offline`, because
   * registry rows survive their device by up to 75 s and device ids are
   * per-launch, so any relaunched phone or closed tab leaves a row that still
   * looks online. Swallowing it is what made choosing a device "do nothing"
   * (owner report 2026-08-16, point 6): the tap had no acknowledgement
   * channel at all, so a refusal and a success were indistinguishable.
   */
  | { kind: "transfer_failed" };

export interface PlaybackChannelDeps {
  cable: CableClient;
  engine: RemoteEngine;
  localState: LocalPlaybackState;
  /** Per-launch [A-Za-z0-9-]{8,64}; the server composes "<session>:<id>". */
  deviceId: string;
  deviceLabel?: string;
  now?(): number;
  /** Lock-screen metadata follows the snapshot song while controlling. */
  setLockScreenSong?(song: Song | null): void;
  /** Toasts: no active device, another device needs a tap. */
  notify?(notice: RemoteNotice): void;
  /** Fallback label for a device with no usable name. */
  deviceFallbackLabel?: string;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : null;

const asDeviceId = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

export class PlaybackChannelManager {
  private sub: CableSubscription | null = null;
  private readonly publisher: ActivePublisher;
  private readonly ticker: ControllerTicker;
  private readonly unsubs: (() => void)[] = [];
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private activationTimer: ReturnType<typeof setTimeout> | null = null;
  private started = false;

  /** Last full `queue_songs` list; slim state_changed frames merge with it. */
  private lastFullQueueSongs: Song[] | undefined;
  private lastTick: PositionTick | null = null;
  /** The cable dropped while WE owned audio: steal back on reconnect. */
  private lostActive = false;
  private role: RemoteRole = "offline";
  /** setQueue takeover in flight: promotion must not re-adopt the snapshot. */
  private takeoverPending = false;
  /** Self-initiated if_none claim: already playing the hydrated queue. */
  private selfClaimPending = false;
  /** A `transfer` was sent and neither a state change nor an error answered. */
  private transferPending = false;
  /** Lock-screen override bookkeeping (avoid republishing the same song). */
  private overriddenSongId: string | null = null;

  constructor(private readonly deps: PlaybackChannelDeps) {
    this.publisher = new ActivePublisher({
      perform: (action, data) => this.perform(action, data),
      localState: deps.localState,
    });
    this.ticker = new ControllerTicker({
      getTick: () => this.lastTick,
      now: () => this.now(),
    });
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  // ----- lifecycle ----------------------------------------------------------

  start(): void {
    if (this.started) return;
    this.started = true;

    this.unsubs.push(
      this.deps.cable.onStateChange((state) => {
        if (state !== "connected") {
          // Remember activeness across the drop: audio kept playing here.
          if (this.role === "active") this.lostActive = true;
          applyRemote({ cableState: state, ready: false });
        } else {
          applyRemote({ cableState: state });
        }
      }),
    );

    // Identifier key order is byte-stable and echoed verbatim by the server.
    // `predecessor` (the web reload handoff) is deliberately never sent.
    const sub = this.deps.cable.subscribe(
      {
        channel: "PlaybackChannel",
        device_id: this.deps.deviceId,
        device_label: this.deps.deviceLabel ?? "",
      },
      {
        onMessage: (msg) => this.handleMessage(msg),
        onConfirm: () => applyRemote({ ready: true }),
        // Anonymous cable connects succeed; a rejection IS the auth failure.
        onReject: () => applyRemote({ ready: false }),
      },
    );
    // iOS freezes timers in background: on wake, pull fresh truth + presence.
    sub.setWakeHook(() => {
      sub.perform("request_snapshot");
      sub.perform("heartbeat");
    });
    this.sub = sub;

    this.startHeartbeat();
    this.publisher.start();
    this.unsubs.push(this.deps.engine.on("audiblePlaying", () => this.onAudiblePlaying()));
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.clearHeartbeat();
    this.clearActivationTimer();
    this.ticker.stop();
    this.publisher.stop();
    for (const unsub of this.unsubs.splice(0)) {
      try {
        unsub();
      } catch {
        // A failing teardown must not block the others.
      }
    }
    this.sub?.unsubscribe();
    this.sub = null;
    this.lastFullQueueSongs = undefined;
    this.lastTick = null;
    this.lostActive = false;
    this.takeoverPending = false;
    this.selfClaimPending = false;
    this.role = "offline";
    this.clearLockScreenOverride();
    resetRemoteStore();
  }

  isStarted(): boolean {
    return this.started;
  }

  /** App foregrounded: heal the socket, then the wake hooks do the rest. */
  notifyForeground(): void {
    this.deps.cable.notifyForeground();
  }

  // ----- outgoing actions ---------------------------------------------------

  private perform(action: string, data?: Record<string, unknown>): void {
    // Pre-welcome sends are dropped by the client, so no ready guards here
    // (a force-publish after a reconnect steal must never be swallowed by a
    // stale readiness flag).
    this.sub?.perform(action, data);
  }

  claimActive(mode: ClaimMode): void {
    this.perform("claim_active", { mode });
    if (mode !== "steal") return;
    // Steals are unconditional server-side (last writer wins): adopt
    // activeness optimistically so a takeover plays NOW.
    const yours = remoteStore.getState().yourDeviceId;
    if (!yours) return;
    applyRemote({ activeDeviceId: yours });
    this.afterStateChange();
  }

  /** Transfer to any ONLINE device, including self ("Play here"). */
  transferTo(deviceId: string): void {
    // Remembered only so an `error` frame can be attributed to THIS tap; any
    // frame that actually moves activeness clears it again.
    this.transferPending = true;
    this.perform("transfer", { target_device_id: deviceId });
  }

  sendCommand(command: string, args?: Record<string, unknown>): void {
    this.perform("command", { command, args: args ?? {} });
  }

  requestSnapshot(): void {
    this.perform("request_snapshot");
  }

  /** A local setQueue takeover claimed activeness: skip snapshot adoption. */
  markTakeover(): void {
    this.takeoverPending = true;
  }

  /** A self-initiated if_none claim: skip snapshot adoption on promotion. */
  markSelfClaim(): void {
    this.selfClaimPending = true;
  }

  // ----- incoming frames ----------------------------------------------------

  private handleMessage(raw: unknown): void {
    const msg = asRecord(raw);
    if (!msg) return;
    switch (msg.type) {
      case "snapshot":
        this.onSnapshot(msg);
        return;
      case "state_changed":
        this.onStateChanged(msg);
        return;
      case "position_tick":
        this.onPositionTick(msg);
        return;
      case "devices_changed":
        this.onDevicesChanged(msg);
        return;
      case "command":
        this.onCommand(msg);
        return;
      case "claim_rejected":
        // Lost an if_none race: adopt the winner and demote.
        this.selfClaimPending = false;
        applyRemote({ activeDeviceId: asDeviceId(msg.active_device_id) });
        this.afterStateChange();
        return;
      case "no_active_device":
        applyRemote({ activeDeviceId: null });
        this.deps.notify?.({ kind: "no_active_device" });
        this.afterStateChange();
        return;
      case "activation_blocked":
        this.onActivationBlocked(msg);
        return;
      case "error":
        // The server rejected or clamped one of our sends: resync, never
        // retry blindly (each blind retry is a rate-limit page). If the send
        // we are still waiting on was a TRANSFER, say so - that tap moved
        // nothing and the user is owed the news.
        if (this.transferPending) {
          this.transferPending = false;
          this.deps.notify?.({ kind: "transfer_failed" });
        }
        this.requestSnapshot();
        return;
      default:
        return;
    }
  }

  private onSnapshot(msg: Record<string, unknown>): void {
    const prev = remoteStore.getState();
    const yours = asDeviceId(msg.your_device_id) ?? prev.yourDeviceId;
    const active = asDeviceId(msg.active_device_id);
    const devices = Array.isArray(msg.devices)
      ? (msg.devices as PlaybackDevice[])
      : prev.devices;
    const state = asRecord(msg.state) as PlaybackSnapshot | null;

    let snapshot = prev.snapshot;
    if (state) {
      if (state.queue_songs) this.lastFullQueueSongs = state.queue_songs;
      snapshot = mergeSlimState(state, this.lastFullQueueSongs);
      this.lastTick = tickFromSnapshot(snapshot, this.now());
    }

    applyRemote({
      yourDeviceId: yours,
      activeDeviceId: active,
      devices,
      snapshot,
      ...(state
        ? {
            controllerPosition: snapshot?.position ?? 0,
            controllerPaused: snapshot?.paused ?? true,
          }
        : {}),
      blockedDeviceId: null,
    });

    // FR-112: the cable dropped while we owned audio and nobody claimed
    // meanwhile - steal it back and publish the truth we never stopped
    // playing. Flagged as a takeover so promotion does not re-adopt.
    if (this.lostActive && yours && (active === null || active === yours)) {
      this.lostActive = false;
      this.perform("claim_active", { mode: "steal" });
      // Flagged as self-initiated: we kept playing through the blip, so the
      // snapshot must NOT be adopted on top of live audio. When the store
      // already read "active" there is no transition to consume the flag,
      // hence the explicit reset.
      this.takeoverPending = true;
      applyRemote({ activeDeviceId: yours });
      this.afterStateChange();
      this.takeoverPending = false;
      this.publisher.forcePublishNow();
      return;
    }
    this.lostActive = false;
    this.afterStateChange();
  }

  private onStateChanged(msg: Record<string, unknown>): void {
    this.transferPending = false;
    const state = asRecord(msg.state) as PlaybackSnapshot | null;
    // `?? ` chain matches the web: an absent top-level id falls back to the
    // one embedded in the state payload.
    const active = asDeviceId(msg.active_device_id) ?? asDeviceId(state?.active_device_id);

    if (state) {
      if (state.queue_songs) this.lastFullQueueSongs = state.queue_songs;
      const snapshot = mergeSlimState(state, this.lastFullQueueSongs);
      this.lastTick = tickFromSnapshot(snapshot, this.now());
      applyRemote({
        snapshot,
        activeDeviceId: active,
        controllerPosition: snapshot.position ?? 0,
        controllerPaused: snapshot.paused ?? true,
        blockedDeviceId: null,
      });
    } else {
      applyRemote({ activeDeviceId: active, blockedDeviceId: null });
    }
    this.afterStateChange();
  }

  private onPositionTick(msg: Record<string, unknown>): void {
    const tickSong = normalizeWireSongId(msg.song_id);
    const snapSong = normalizeWireSongId(remoteStore.getState().snapshot?.song_id ?? null);
    // A tick that raced a track change would flash the previous song's
    // position across the transition: drop it.
    if (tickSong !== snapSong) return;
    const position = Number(msg.position);
    const paused = !!msg.paused;
    const serverTime = Number(msg.server_time);
    this.lastTick = {
      position: Number.isFinite(position) ? position : 0,
      paused,
      songId: tickSong,
      serverTimeMs: Number.isFinite(serverTime) ? serverTime : this.now(),
      receivedAtMs: this.now(),
    };
    if (remoteStore.getState().controllerPaused !== paused) {
      applyRemote({ controllerPaused: paused });
    }
    this.ticker.publish();
  }

  private onDevicesChanged(msg: Record<string, unknown>): void {
    this.transferPending = false;
    applyRemote({
      ...(Array.isArray(msg.devices) ? { devices: msg.devices as PlaybackDevice[] } : {}),
      // A devices_changed that carries only the ROSTER and omits the active
      // id must not read as "nobody is active": taken literally it demoted
      // every device to no_active, and the re-promotion that followed
      // re-entered promoteToActive with no takeover pending, re-adopting a
      // snapshot on top of live local audio.
      //
      // Absent and explicitly-null are different answers, so this tests for
      // the KEY, not for a falsy value: `{ active_device_id: null }` is the
      // server saying the vacancy out loud and is still honoured.
      ...("active_device_id" in msg
        ? { activeDeviceId: asDeviceId(msg.active_device_id) }
        : {}),
    });
    this.afterStateChange();
  }

  private onCommand(msg: Record<string, unknown>): void {
    // Commands are broadcast to everyone; ONLY the targeted device executes.
    const target = asDeviceId(msg.target_device_id);
    if (!target || target !== remoteStore.getState().yourDeviceId) return;
    const command = typeof msg.command === "string" ? msg.command : null;
    if (!command) return;
    executeRemoteCommand(
      this.deps.engine,
      this.deps.localState,
      command,
      asRecord(msg.args) ?? undefined,
    );
  }

  private onActivationBlocked(msg: Record<string, unknown>): void {
    const blockedDeviceId = asDeviceId(msg.device_id);
    applyRemote({ blockedDeviceId });
    const state = remoteStore.getState();
    if (!blockedDeviceId || blockedDeviceId === state.yourDeviceId) return;
    const device = state.devices.find((d) => d.id === blockedDeviceId) ?? null;
    this.deps.notify?.({
      kind: "device_needs_tap",
      deviceLabel: deviceDisplayLabel(device, this.deps.deviceFallbackLabel ?? "device"),
    });
  }

  // ----- role machine -------------------------------------------------------

  /**
   * Runs after EVERY store write that can move the role. Role transitions
   * are edge-triggered; the lock-screen override and cold-start hydration
   * are level-triggered (they must react to later snapshots too).
   */
  private afterStateChange(): void {
    const next = remoteStore.getState().role;
    const prev = this.role;
    if (next !== prev) {
      this.role = next;
      if (next !== "active") {
        // blocked/activating are sub-states of active: any demotion clears
        // them (and the pending-claim flags, which only guard a promotion).
        this.clearActivationTimer();
        this.takeoverPending = false;
        this.selfClaimPending = false;
        applyRemote({ activating: false, blocked: false });
      }
      if (next === "controller") this.enterController();
      else if (prev === "controller") this.leaveController();
      if (next === "active" && prev !== "active") this.promoteToActive();
    }

    if (this.role === "controller") {
      this.syncLockScreenOverride();
      this.ticker.publish();
    }
    if (this.role === "no_active") this.maybeHydrate();
  }

  /** Another device owns audio: this one goes silent, source cleared. */
  private enterController(): void {
    this.deps.engine.stopAndClearSource();
    this.ticker.start();
    this.syncLockScreenOverride();
  }

  private leaveController(): void {
    this.ticker.stop();
    this.clearLockScreenOverride();
  }

  /**
   * Transfer / picker "Play here" / server-side promotion (FR-111). A local
   * takeover or self-claim already plays the right thing: never re-adopt.
   */
  private promoteToActive(): void {
    const selfInitiated = this.takeoverPending || this.selfClaimPending;
    this.takeoverPending = false;
    this.selfClaimPending = false;
    if (selfInitiated) return;

    const snapshot = this.snapshotForActivation();
    if (!snapshot) return;
    const resumesPlaying = adoptForActivation(this.deps.engine, snapshot);
    if (!resumesPlaying) return;
    // Playing audio transferred in: spinner + suppressed publishes until the
    // first audible status force-publishes the truth.
    applyRemote({ activating: true });
    this.startActivationTimer();
  }

  /**
   * The snapshot to adopt on activation, with the newest tick folded in.
   *
   * `paused` and `position` are read from the last FULL `state_changed`, and
   * position ticks - which arrive every second and carry both - never touch
   * it. So a transfer mid-song adopted whatever the last full frame said,
   * which is how the owner's music arrived on the phone paused and seconds
   * behind (report 2026-08-16, point 6): the other device had said "playing,
   * at 0:04" a minute earlier and nothing since had been allowed to update
   * that. Every ambiguity in this path resolves to paused (`?? true` in
   * adoption and in both frame handlers), so a stale frame is not a
   * coin-flip, it is a reliable wrong answer.
   *
   * The tick is only trusted for the SAME song, and its position is only
   * extrapolated while it is fresh enough to extrapolate (STALE_TICK_MS) and
   * actually playing. `paused` is taken from it either way: however old the
   * tick is, it is still younger than the frame it corrects.
   */
  private snapshotForActivation(): PlaybackSnapshot | null {
    const snapshot = remoteStore.getState().snapshot;
    if (!snapshot) return null;
    const tick = this.lastTick;
    if (!tick) return snapshot;
    if (normalizeWireSongId(tick.songId) !== normalizeWireSongId(snapshot.song_id ?? null)) {
      return snapshot;
    }
    const ageMs = this.now() - tick.receivedAtMs;
    const fresh = ageMs >= 0 && ageMs <= STALE_TICK_MS;
    const raw =
      fresh && !tick.paused
        ? tick.position + ageMs / 1000
        : fresh
          ? tick.position
          : snapshot.position;
    // Rounded to a tenth: the extrapolation is an estimate of where the other
    // device has got to, and a seek lands on a frame boundary anyway, so the
    // extra digits are noise. Rounding also keeps a tick seeded from the very
    // frame being adopted (age ~1 ms) reading as the position that frame
    // stated, instead of a millisecond past it.
    const position = Math.round(raw * 10) / 10;
    return { ...snapshot, paused: tick.paused, position };
  }

  /** FR-108: nobody is active, the account has a queue, this device does not. */
  private maybeHydrate(): void {
    const snapshot = remoteStore.getState().snapshot;
    if (!snapshot || !hasAdoptableQueue(snapshot)) return;
    if (this.deps.engine.getQueueState().queue.length > 0) return;
    adoptForHydration(this.deps.engine, snapshot);
  }

  private onAudiblePlaying(): void {
    const state = remoteStore.getState();
    if (state.role !== "active") return;
    this.clearActivationTimer();
    if (!state.activating && !state.blocked) return;
    // First audible frame after an activation (or after the user's gesture
    // cleared a blocked start): publish the full truth plus a tick.
    applyRemote({ activating: false, blocked: false });
    this.publisher.forcePublishNow();
  }

  private startActivationTimer(): void {
    this.clearActivationTimer();
    this.activationTimer = setTimeout(() => {
      this.activationTimer = null;
      const state = remoteStore.getState();
      if (state.role !== "active" || !state.activating) return;
      if (this.deps.localState.getState().playing) return;
      // Audio never started: tell every device this one needs a tap and
      // keep publishes suppressed (no phantom paused:true).
      applyRemote({ activating: false, blocked: true, blockedDeviceId: state.yourDeviceId });
      this.perform("activation_blocked");
    }, ACTIVATION_TIMEOUT_MS);
  }

  private clearActivationTimer(): void {
    if (!this.activationTimer) return;
    clearTimeout(this.activationTimer);
    this.activationTimer = null;
  }

  // ----- lock screen (FR-63 remote half) ------------------------------------

  /** While controlling, the lock screen describes the REMOTE song. */
  private syncLockScreenOverride(): void {
    if (!this.deps.setLockScreenSong) return;
    const song = snapshotCurrentSong(remoteStore.getState().snapshot);
    const id = song ? String(song.id) : null;
    if (id === this.overriddenSongId) return;
    this.overriddenSongId = id;
    this.deps.setLockScreenSong(song);
  }

  private clearLockScreenOverride(): void {
    if (this.overriddenSongId === null) return;
    this.overriddenSongId = null;
    this.deps.setLockScreenSong?.(null);
  }

  // ----- timers -------------------------------------------------------------

  private startHeartbeat(): void {
    this.clearHeartbeat();
    this.perform("heartbeat");
    this.heartbeatTimer = setInterval(() => this.perform("heartbeat"), HEARTBEAT_INTERVAL_MS);
  }

  private clearHeartbeat(): void {
    if (!this.heartbeatTimer) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Singleton accessor: the UI (DevicePicker, controller strip) talks to the
// live channel through these, so it renders inertly before boot wiring runs.
// ---------------------------------------------------------------------------

let current: PlaybackChannelManager | null = null;

export const setPlaybackChannel = (channel: PlaybackChannelManager | null): void => {
  current = channel;
};

export const getPlaybackChannel = (): PlaybackChannelManager | null => current;

export const remoteTransferTo = (deviceId: string): void => {
  current?.transferTo(deviceId);
};

export const remoteRequestSnapshot = (): void => {
  current?.requestSnapshot();
};
