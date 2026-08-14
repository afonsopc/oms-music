/**
 * The Rust cache's event stream, forwarded into the app's ONE status map.
 *
 * This file is deliberately dumb, and that is the design. `downloads/status.ts`
 * is reused VERBATIM - not reimplemented, not wrapped - so the two-channel
 * discipline the 2026-08-14 freeze report established is literally the same
 * code on both platforms (invariant I1):
 *
 *   - a `status` event is a TRANSITION, so `setKindStatus` bumps the coarse
 *     channel and every mounted badge re-renders once;
 *   - a `progress` event carries the SAME status string as the row already
 *     has, so `setKindStatus` routes it to the ~1 Hz progress channel and no
 *     badge re-renders at all.
 *
 * The split itself is decided in Rust (cache/events.rs applies the same
 * 250 ms coarse / 1000 ms progress rule before anything crosses the IPC
 * boundary), so three parallel transfers cannot flood this function either.
 * Two layers of the same discipline, and neither trusts the other.
 */
import type { DownloadKind } from "@/domain/downloads";
import type { SongKey } from "@/domain/ids";
import { getKindStatus, setKindStatus } from "../status";
import type { CacheEvent } from "./bridge";

/**
 * Where the local file index listens. Kept as a plain setter instead of an
 * import so this module stays free of everything but status.ts: it is the one
 * piece of the desktop fork whose behaviour a bun test can pin down exactly,
 * and a transitive import of the Tauri bridge would take that away.
 */
type CacheEventObserver = (event: CacheEvent) => void;

let observer: CacheEventObserver | null = null;

export const setCacheEventObserver = (fn: CacheEventObserver | null): void => {
  observer = fn;
};

export const applyCacheEvent = (event: CacheEvent): void => {
  const songKey = event.songKey as SongKey;
  const kind = event.kind as DownloadKind;

  if (event.type === "status") {
    setKindStatus(songKey, kind, event.status, event.progress);
  } else {
    // The status string must NOT change here. Passing the row's current one is
    // what makes status.ts take the progress branch; inventing a status (or
    // passing "downloading" unconditionally) would bump the coarse channel on
    // every percent sample, which is precisely the render storm this whole
    // split exists to prevent.
    //
    // The fallback only fires when a progress sample arrives before any status
    // event for that row - Rust does not do that, but a dropped first message
    // must leave the row visibly transferring rather than invisible.
    const current = getKindStatus(songKey, kind)?.status ?? "downloading";
    setKindStatus(songKey, kind, current, event.progress);
  }

  observer?.(event);
};
