/**
 * Recently PLAYED collections, recorded locally (owner request 2026-08-11:
 * "a home não mostra a minha playlist tocada mais recente"). The server's
 * play events carry no collection context, so the app itself remembers which
 * playlist/album/mix/liked screen a queue was started from - kv-backed,
 * newest first, deduped by identity, capped. The home quick grid merges this
 * with the server's recent ALBUMS (which cover cross-device listening).
 */
import { kvGetJson, kvSetJson } from "@/db/kv";

export interface RecentCollection {
  /** Routing identity: what to open when the tile is tapped. */
  kind: "playlist" | "album" | "liked" | "mix" | "radio";
  /** playlist id, `${artistSegment}::${album}`, mix slug, radio slug... */
  key: string;
  title: string;
  /** Bare fs node for the tile artwork; null falls to kind art/placeholder. */
  artworkNodeId: string | null;
  /** External artwork URL (mix artist photos); node wins when both exist. */
  artworkUrl?: string | null;
  /** Liked-heart tile art (the Gostadas screen and the Spotify liked MIRROR
   *  playlist, which has no artwork node and must never fall to the
   *  placeholder photo). Wins over node/url. */
  heart?: boolean;
  at: number;
}

const KV_KEY = "oms-music.recent-collections";
const CAP = 16;

let cached: RecentCollection[] | null = null;
const listeners = new Set<() => void>();

const load = (): RecentCollection[] => {
  cached ??= kvGetJson<RecentCollection[]>(KV_KEY) ?? [];
  return cached;
};

export const getRecentCollections = (): RecentCollection[] => load();

export const subscribeRecentCollections = (cb: () => void): (() => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

/** Called by CollectionScreen whenever a queue starts from a collection. */
export const recordRecentCollection = (
  entry: Omit<RecentCollection, "at">,
): void => {
  const next = [
    { ...entry, at: Date.now() },
    ...load().filter((e) => !(e.kind === entry.kind && e.key === entry.key)),
  ].slice(0, CAP);
  cached = next;
  kvSetJson(KV_KEY, next);
  for (const cb of listeners) cb();
};
