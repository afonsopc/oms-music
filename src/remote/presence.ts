/**
 * Presence aging for the DevicePicker (handoff 2026-08-17 §5.4): device ids
 * are per-launch and the server only broadcasts `devices_changed` on
 * subscribe/unsubscribe - heartbeats touch the registry WITHOUT broadcasting
 * - so a relaunched phone or a crashed tab leaves a roster row that every
 * other client keeps rendering as online forever. The server cannot help
 * retroactively (it reaps stale rows only when it next serializes a roster),
 * so the client ages the rows itself: a row without a heartbeat for
 * STALE_PRESENCE_MS renders dimmed as "seen X min ago", and one dead for
 * GONE_PRESENCE_MS disappears from the list.
 *
 * Ages never compare the client clock against the server's: `last_seen_at`
 * is server time, so the freshest online row of the SAME frame stands in for
 * "server now at frame time" (the anchor - every live client heartbeats each
 * 20 s, so the anchor lags real server-now by at most that), and the time
 * since the frame arrived is measured purely on the client clock. Raw
 * `Date.now() - last_seen_at` would dim every row on a device with a skewed
 * clock.
 *
 * Pure and react-free on purpose, like the rest of src/remote: bun-testable
 * without a UI.
 */
import type { PlaybackDevice } from "@/domain/playback";

/**
 * Heartbeats run every 20 s and the server TTL is 75 s: a row 90 s without
 * one is either dead server-side already, or the roster frame itself is old
 * enough that the picker's own refresh (below) is about to disambiguate.
 */
export const STALE_PRESENCE_MS = 90_000;

/** "Some após muito tempo": a row this long without a heartbeat just hides. */
export const GONE_PRESENCE_MS = 10 * 60_000;

/**
 * While the picker is on screen, a roster older than this is re-requested:
 * dead rows can only be told apart from a stale ROSTER by fresh data, and a
 * request_snapshot also makes the server reap them for everyone after.
 */
export const ROSTER_REFRESH_MS = 60_000;

/** UI cadence for re-deriving ages (and re-requesting, when due). */
export const PRESENCE_TICK_MS = 30_000;

export type DevicePresence =
  | { kind: "fresh" }
  | { kind: "stale"; minutes: number }
  | { kind: "gone" };

const parseSeenMs = (device: PlaybackDevice): number | null => {
  if (!device.online || !device.last_seen_at) return null;
  const ms = Date.parse(device.last_seen_at);
  return Number.isFinite(ms) ? ms : null;
};

/**
 * "Server now" at frame time: the freshest heartbeat the frame carries.
 * Offline recents carry `last_used_at` instead and never anchor.
 */
export const presenceAnchorMs = (devices: PlaybackDevice[]): number | null => {
  let anchor: number | null = null;
  for (const device of devices) {
    const seen = parseSeenMs(device);
    if (seen !== null && (anchor === null || seen > anchor)) anchor = seen;
  }
  return anchor;
};

/**
 * Presence of one ONLINE roster row. `rosterAgeMs` is the client-clock time
 * since the roster frame arrived (the store's `devicesAt`); rows or frames
 * without a usable timestamp fall back to trusting `online` as-is.
 */
export const devicePresence = (
  device: PlaybackDevice,
  anchorMs: number | null,
  rosterAgeMs: number,
): DevicePresence => {
  const seen = parseSeenMs(device);
  if (seen === null || anchorMs === null) return { kind: "fresh" };
  const sinceHeartbeat = Math.max(0, rosterAgeMs) + Math.max(0, anchorMs - seen);
  if (sinceHeartbeat >= GONE_PRESENCE_MS) return { kind: "gone" };
  if (sinceHeartbeat >= STALE_PRESENCE_MS) {
    return { kind: "stale", minutes: Math.max(1, Math.floor(sinceHeartbeat / 60_000)) };
  }
  return { kind: "fresh" };
};
