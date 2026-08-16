/**
 * Remote playback store (FR-107): the zustand mirror of PlaybackChannel
 * truth. The role is DERIVED on every write, never set directly:
 *
 *   offline    - no snapshot ever received (logged out / cable never up)
 *   no_active  - connected, nobody owns audio (render snapshot, paused)
 *   active     - this device owns audio (publishes state + 1 Hz ticks)
 *   controller - another device owns audio (mirror snapshot, send commands)
 *
 * `activating`/`blocked` are client sub-states of "active", cleared on any
 * demotion (the channel owns that transition logic). Controller position is
 * a leaf field updated at ~1 Hz by the controller ticker.
 */
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import type { CableState } from "@/cable/types";
import type { PlaybackDevice, PlaybackSnapshot } from "@/domain/playback";

export type RemoteRole = "offline" | "no_active" | "active" | "controller";

export interface RemoteStoreState {
  cableState: CableState;
  /** Subscription confirmed by the server (not just socket-open). */
  ready: boolean;
  role: RemoteRole;
  /** Composed "<session_id>:<device_id>" from the wire; null pre-snapshot. */
  yourDeviceId: string | null;
  activeDeviceId: string | null;
  devices: PlaybackDevice[];
  /**
   * Client receipt time (ms) of the last frame that carried a roster; 0
   * before the first one. Presence aging (remote/presence.ts) needs it
   * because `last_seen_at` is server time and only fresh relative to the
   * frame it arrived in.
   */
  devicesAt: number;
  /** Always MERGED: slim state_changed frames get the last full queue_songs. */
  snapshot: PlaybackSnapshot | null;
  /** Interpolated display position while controlling (FR-109). */
  controllerPosition: number;
  controllerPaused: boolean;
  /** Active sub-state: resuming transferred audio, publishes suppressed. */
  activating: boolean;
  /** Active sub-state: audio start refused, needs a user tap. */
  blocked: boolean;
  /** Device named by the last activation_blocked, until the next state change. */
  blockedDeviceId: string | null;
}

export const initialRemoteState: RemoteStoreState = {
  cableState: "disconnected",
  ready: false,
  role: "offline",
  yourDeviceId: null,
  activeDeviceId: null,
  devices: [],
  devicesAt: 0,
  snapshot: null,
  controllerPosition: 0,
  controllerPaused: true,
  activating: false,
  blocked: false,
  blockedDeviceId: null,
};

/** Pure role derivation (unit-tested). */
export const computeRole = (
  s: Pick<RemoteStoreState, "snapshot" | "activeDeviceId" | "yourDeviceId">,
): RemoteRole => {
  if (s.snapshot === null) return "offline";
  if (s.activeDeviceId === null) return "no_active";
  if (s.yourDeviceId !== null && s.activeDeviceId === s.yourDeviceId) return "active";
  return "controller";
};

export const remoteStore = createStore<RemoteStoreState>()(() => ({
  ...initialRemoteState,
}));

/** The ONLY legal writer: recomputes the derived role on every change. */
export const applyRemote = (partial: Partial<Omit<RemoteStoreState, "role">>): void => {
  remoteStore.setState((prev) => {
    const next = { ...prev, ...partial };
    next.role = computeRole(next);
    return next;
  });
};

export const resetRemoteStore = (): void => {
  remoteStore.setState({ ...initialRemoteState, devices: [] }, true);
};

/** React hook; always pass a selector (keep them pure and stable). */
export const useRemoteStore = <T>(selector: (state: RemoteStoreState) => T): T =>
  useStore(remoteStore, selector);

export const selectActiveDevice = (s: RemoteStoreState): PlaybackDevice | null =>
  s.devices.find((d) => d.id === s.activeDeviceId) ?? null;

export const selectSelfDevice = (s: RemoteStoreState): PlaybackDevice | null =>
  s.devices.find((d) => d.id === s.yourDeviceId) ?? null;

/**
 * Display label pick order from the web DevicePicker: registry label wins,
 * session fields back up offline recents.
 */
export const deviceDisplayLabel = (
  d: PlaybackDevice | null | undefined,
  fallback: string,
): string =>
  d?.label?.trim() || d?.description?.trim() || d?.name || d?.device_type || fallback;
