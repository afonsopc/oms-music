/**
 * Presigned URL resolution (FR-55/60; DESIGN 8.2). Cache keyed by fs node id
 * (NEVER by URL - every resolve mints a different presigned URL), in-flight
 * promise dedupe, 2 attempts, and a reuse window of 5 minutes valid only for
 * playback START. `fresh: true` (error recovery) bypasses and
 * hard-invalidates. Plus the one-shot prefetch slot for the upcoming song.
 */
import type { FsNodeId, SongKey } from "@/domain/ids";
import type { PrefetchedUrl } from "./types";

/** Matches the web PREFETCHED_URL_TTL_MS; also the cache reuse window. */
export const URL_REUSE_WINDOW_MS = 5 * 60 * 1000;

interface CacheEntry {
  url: string;
  resolvedAt: number;
}

export class PresignedResolver {
  private readonly cache = new Map<FsNodeId, CacheEntry>();
  private readonly inFlight = new Map<FsNodeId, Promise<string>>();
  private prefetched: PrefetchedUrl | null = null;
  private prefetchInFlightSongKey: SongKey | null = null;

  constructor(
    private readonly resolveDataUrl: (nodeId: FsNodeId) => Promise<string>,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Resolve a playable URL for the node. Reuses a cached entry only within
   * the 5 minute window; `fresh` invalidates and always hits the network.
   * Two attempts total; the second failure rejects.
   */
  resolve(nodeId: FsNodeId, opts?: { fresh?: boolean }): Promise<string> {
    if (opts?.fresh) {
      this.cache.delete(nodeId);
      this.inFlight.delete(nodeId);
    } else {
      const cached = this.cache.get(nodeId);
      if (cached && this.now() - cached.resolvedAt < URL_REUSE_WINDOW_MS) {
        return Promise.resolve(cached.url);
      }
      const pending = this.inFlight.get(nodeId);
      if (pending) return pending;
    }
    const attempt = this.resolveDataUrl(nodeId).catch(() => this.resolveDataUrl(nodeId));
    const wrapped = attempt
      .then((url) => {
        this.cache.set(nodeId, { url, resolvedAt: this.now() });
        return url;
      })
      .finally(() => {
        if (this.inFlight.get(nodeId) === wrapped) this.inFlight.delete(nodeId);
      });
    this.inFlight.set(nodeId, wrapped);
    return wrapped;
  }

  /** Invalidate a node's cached URL (stream error recovery). */
  invalidate(nodeId: FsNodeId): void {
    this.cache.delete(nodeId);
  }

  /**
   * One-shot prefetch for the upcoming song (FR-60): single attempt, one
   * in-flight prefetch per song, result stored in the slot.
   */
  prefetch(songKey: SongKey, nodeId: FsNodeId): void {
    const slot = this.prefetched;
    if (
      slot &&
      slot.songKey === songKey &&
      slot.nodeId === nodeId &&
      this.now() - slot.resolvedAt < URL_REUSE_WINDOW_MS
    ) {
      return;
    }
    if (this.prefetchInFlightSongKey === songKey) return;
    this.prefetchInFlightSongKey = songKey;
    void this.resolveDataUrl(nodeId)
      .then((url) => {
        this.prefetched = { songKey, nodeId, url, resolvedAt: this.now() };
      })
      .catch(() => undefined)
      .finally(() => {
        if (this.prefetchInFlightSongKey === songKey) this.prefetchInFlightSongKey = null;
      });
  }

  /**
   * Consume the prefetched URL - honored only on songKey AND nodeId match
   * within the window, cleared on use (one-shot): a stream error that
   * re-resolves the same song must mint a genuinely fresh URL.
   */
  takePrefetched(songKey: SongKey, nodeId: FsNodeId): string | null {
    const slot = this.prefetched;
    if (!slot) return null;
    if (
      slot.songKey !== songKey ||
      slot.nodeId !== nodeId ||
      this.now() - slot.resolvedAt >= URL_REUSE_WINDOW_MS
    ) {
      return null;
    }
    this.prefetched = null;
    return slot.url;
  }

  clearPrefetched(): void {
    this.prefetched = null;
  }
}
