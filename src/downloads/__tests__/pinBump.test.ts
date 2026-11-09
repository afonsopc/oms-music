/**
 * Owner report 2026-11-09: a playlist download showed no per-song state.
 * The rows on screen are exactly the ones the play cache / viewport prefetch
 * had already written as ORPHAN mixed rows - silently, because nothing can
 * render an unpinned song. Pinning such a song changes what `getStatusFor`
 * answers without changing the map, so the pin has to bump the coarse channel
 * itself (`bumpDownloadStatus`), and that bump must NOT also tick the
 * progress channel (transition discipline of the 2026-08-14 freeze report).
 */
import { beforeEach, describe, expect, it } from "bun:test";
import {
  bumpDownloadStatus,
  getMixedStatus,
  getProgressVersion,
  getStatusVersion,
  resetStatuses,
  setKindStatus,
  subscribeDownloadProgress,
  subscribeDownloadStatus,
} from "../status";
import type { SongKey } from "@/domain/ids";

const drain = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 1_100));

describe("pin over an orphan row", () => {
  beforeEach(() => {
    resetStatuses();
  });

  it("a silent orphan write stays silent; the pin bump notifies once", async () => {
    let coarseCalls = 0;
    const offCoarse = subscribeDownloadStatus(() => coarseCalls++);
    const offProgress = subscribeDownloadProgress(() => {});
    await drain();
    coarseCalls = 0;
    const coarseBefore = getStatusVersion();
    const progressBefore = getProgressVersion();

    const key = "123" as SongKey;
    // Prefetch landed the file: map written, nobody told.
    setKindStatus(key, "mixed", "queued", 0, true);
    setKindStatus(key, "mixed", "done", 1, true);
    await drain();
    expect(getStatusVersion()).toBe(coarseBefore);
    expect(getMixedStatus(key)).toBe("done");

    // The collection download pins it.
    bumpDownloadStatus();
    bumpDownloadStatus(); // coalesced within the window
    await drain();
    expect(getStatusVersion()).toBe(coarseBefore + 1);
    expect(coarseCalls).toBe(1);
    expect(getProgressVersion()).toBe(progressBefore);

    offCoarse();
    offProgress();
  }, 10_000);
});
