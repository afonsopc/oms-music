/**
 * Artwork warming, keyed by MEDIA ID - the one key every consumer reads.
 *
 * THE BUG THIS EXISTS TO FIX
 * --------------------------
 * `warmup.ts` used to call `Image.prefetch(urls)` and `ArtworkImage` renders
 * `{ uri, cacheKey: mediaId }`. Verified against expo-image's own typings:
 * `Image.prefetch(urls, options)` takes only `{ cachePolicy, headers }` -
 * there is NO cacheKey option - and `getCachePathAsync`'s doc says "unless you
 * have set a custom cache key, this will be the source URL of the image".
 *
 * So the sweep stored bytes under `https://backend.../media/123/data?token=X`
 * while every component looked them up under `123`. The two key spaces never
 * intersected: the old warm-up produced exactly ZERO cache hits on native, and
 * a token rotation would have invalidated the warmed set anyway (the token is
 * in the URL, and the URL was the key).
 *
 * THE FIX: a three-step re-key. Pull the bytes (expo-image stores them under
 * the URL), find where they landed, then `writeToCacheAsync` them under the
 * stable media id. `writeToCacheAsync` throws WriteToCacheRemoteSourceException
 * for remote sources, so it MUST be fed the local path - which is why the
 * middle step exists at all.
 *
 * Cost, accepted deliberately: the bytes exist twice on disk, once under the
 * URL key and once under the media id. At 30 to 80 KB a cover that is a few
 * megabytes for a whole library, and expo-image's own eviction handles it
 * (Glide's 250 MB LRU on Android, SDWebImage's 7-day access TTL on iOS).
 *
 * TWO RULES FROM THE RESEARCH, both cheap and both easy to get wrong:
 *  - never trust `Image.prefetch`'s boolean: it resolves false the moment ANY
 *    url in the batch fails, regardless of the rest. Warm one id at a time and
 *    count successes from `getCachePathAsync` instead.
 *  - never rely on this cache for PINNED content. iOS evicts after 7 days of
 *    not being VIEWED and sweeps on every backgrounding, and
 *    `Image.configureCache` exposes maxDiskSize but not maxDiskAge (and is a
 *    no-op on Android). Pinned artwork already lives as a `dl_files` row of
 *    kind `artwork` and ArtworkImage already prefers it. That is correct, and
 *    nothing here touches it.
 *
 * BUDGET: none shared with audio, by construction. Browse artwork lives
 * entirely in expo-image's cache on native and in the browser HTTP cache on
 * web/desktop, so the 100x size disparity between a cover and a track is
 * handled structurally instead of by tuning a shared quota.
 */
import type { Query, QueryKey } from "@tanstack/react-query";
import { Image } from "expo-image";
import { Platform } from "react-native";
import { artworkScope, type ArtworkScopeInput } from "./artworkScope";
import { imageUrl } from "./mediaUrl";
import { queryClient } from "./queryClient";
import type { MediaId } from "@/domain/ids";
import type { MixSummary } from "@/domain/mixes";
import type { Playlist } from "@/domain/playlist";
import { getRecentCollections } from "@/lib/recentCollections";
import { setArtworkPrefetcher } from "@/prefetch/register";
import type { RecentlyPlayedAlbum } from "./endpoints/playEvents";

export { artworkScope, MAX_HOME_ARTWORK, type ArtworkScopeInput } from "./artworkScope";

/** Pause between warms: a sweep, not a burst (same pacing as warmup.ts). */
const STEP_GAP_MS = 150;
/**
 * Backlog ceiling. A fling through a long playlist can ask for hundreds of
 * covers; the ones from three viewports ago are worthless by the time we get
 * to them, so the queue is drained newest-first and trimmed from the front.
 */
const MAX_QUEUE = 64;

// ---------------------------------------------------------------------------
// The paced warmer
// ---------------------------------------------------------------------------

/**
 * Ids this process has already dealt with, successfully or not. Retrying a
 * miss would turn every scroll into a retry storm for songs whose artwork
 * simply does not exist, and a cover that failed once will not succeed on the
 * next viewport either.
 */
const attempted = new Set<MediaId>();
/** Pending ids, oldest at the front. Drained from the BACK (newest first). */
let queue: MediaId[] = [];
let pumping = false;
let warmedCount = 0;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Native: the three-step re-key. Returns 1 when the media-id key is populated
 * afterwards, which is the only success signal worth counting.
 */
const warmNative = async (mediaId: MediaId): Promise<number> => {
  // 1. Residency under the key the COMPONENT reads. Free, no network at all,
  //    and it is what makes a second sweep in the same install nearly free.
  if (await Image.getCachePathAsync(mediaId)) return 0;

  // 2. Pull the bytes. expo-image files them under the URL key.
  await Image.prefetch(imageUrl(mediaId), { cachePolicy: "disk" });

  // 3. Re-key under the stable media id. Without this step the warmed bytes
  //    are unreachable by every consumer in the app.
  const path = await Image.getCachePathAsync(imageUrl(mediaId));
  if (!path) return 0;
  await Image.writeToCacheAsync(path, mediaId);
  return 1;
};

/**
 * Web and the Tauri desktop shell: expo-image has no prefetch and no
 * cacheKey there (enabling cacheKey on web makes expo-image fetch the bytes
 * itself, and that fetch dies on CORS at the storage redirect - see
 * ArtworkImage). The layer that DOES cache on those platforms is the browser's
 * own HTTP cache, fed by the Cache-Control already deployed on
 * `/media/:id/data`, so warming it is a plain image load and nothing more.
 *
 * Known limitation, recorded rather than worked around: `imageUrl` appends
 * `?token=`, so the browser cache key changes on re-login. On desktop the auth
 * mode is Bearer and there is no fixing that client-side. It costs one cold
 * cache after a sign-in, never correctness.
 */
const warmWeb = (mediaId: MediaId): Promise<number> =>
  new Promise((resolve) => {
    if (typeof window === "undefined" || typeof window.Image === "undefined") {
      resolve(0);
      return;
    }
    const img = new window.Image();
    img.onload = () => resolve(1);
    img.onerror = () => resolve(0);
    img.src = imageUrl(mediaId);
  });

const warmOne = async (mediaId: MediaId): Promise<number> => {
  try {
    return Platform.OS === "web" ? await warmWeb(mediaId) : await warmNative(mediaId);
  } catch {
    // Bitmap warming is an optimization; a failure is never an error.
    return 0;
  }
};

const pump = async (): Promise<void> => {
  if (pumping) return;
  pumping = true;
  try {
    for (;;) {
      const next = queue.pop(); // Newest first: the current viewport wins.
      if (next == null) return;
      warmedCount += await warmOne(next);
      await sleep(STEP_GAP_MS);
    }
  } finally {
    pumping = false;
  }
};

/**
 * The `PrefetchHost.prefetchArtwork` implementation: fire and forget, cheap,
 * idempotent. Called from the predictive driver at most once per debounce
 * window with the visible range plus one viewport of lookahead, and from the
 * home sweep with the rail covers.
 *
 * Deliberately allocation-light and synchronous at the call site: the driver
 * runs inside a timer callback that must never block, and this only touches a
 * Set and an array before handing off to the pump.
 */
export const prefetchArtwork = (mediaIds: readonly (MediaId | null | undefined)[]): void => {
  let added = false;
  for (const id of mediaIds) {
    if (!id || attempted.has(id)) continue;
    attempted.add(id);
    queue.push(id);
    added = true;
  }
  if (!added) return;
  // Trim the STALE end: a backlog built during a fling describes rows the
  // user has already scrolled past.
  if (queue.length > MAX_QUEUE) queue = queue.slice(queue.length - MAX_QUEUE);
  void pump();
};

/** Diagnostics for the downloads overview: covers warmed this session. */
export const artworkWarmedCount = (): number => warmedCount;

/** Sign-out: a new user's ids have nothing to do with the old one's queue. */
export const resetArtworkPrefetch = (): void => {
  queue = [];
  attempted.clear();
  warmedCount = 0;
};

// ---------------------------------------------------------------------------
// Home open, watched through the react-query cache
//
// No screen is edited. The three rails the home renders each land in the cache
// under a known key, and warming their covers the moment the LIST arrives -
// rather than when a component mounts - means the tiles are already decoded by
// the time the user's eyes get there. Same WeakSet-guarded pattern as
// downloads/autoSync: a successful fetch produces a fresh data reference, so
// each result object is inspected exactly once.
// ---------------------------------------------------------------------------

const handled = new WeakSet<object>();

const isHomeRailKey = (key: QueryKey): boolean => {
  const parts = key as readonly unknown[];
  return (
    (parts[0] === "playlists" && parts[1] === "list") ||
    (parts[0] === "playEvents" && parts[1] === "recentAlbums") ||
    (parts[0] === "mixes" && parts[1] === "list")
  );
};

/**
 * Reads whatever of the three rails is already cached and warms the union.
 * Cheap to call repeatedly: `artworkScope` caps the list and `prefetchArtwork`
 * drops every id it has already attempted, so the second call after a rail
 * refresh enqueues only what is genuinely new.
 */
export const warmHomeArtwork = (): void => {
  const cache = queryClient.getQueryCache();
  const input: ArtworkScopeInput = { recentCollections: getRecentCollections() };

  for (const query of cache.getAll()) {
    if (query.state.status !== "success") continue;
    const parts = query.queryKey as readonly unknown[];
    const data = query.state.data;
    if (parts[0] === "playlists" && parts[1] === "list" && Array.isArray(data)) {
      input.playlists = data as Playlist[];
    } else if (parts[0] === "playEvents" && parts[1] === "recentAlbums" && Array.isArray(data)) {
      input.recentAlbums = data as RecentlyPlayedAlbum[];
    } else if (parts[0] === "mixes" && parts[1] === "list" && Array.isArray(data)) {
      input.mixes = data as MixSummary[];
    }
  }

  prefetchArtwork(artworkScope(input));
};

let subscribed = false;

/**
 * Installs the artwork half of the predictive prefetcher and starts watching
 * the home rails. Called by `registerLibraryWarmup` (boot/wireup already calls
 * that), so there is no new wireup entry and no new provider.
 *
 * The driver's default artwork host is a NO-OP by design: a bare
 * `Image.prefetch(url)` on native stores under a key nothing reads, so A left
 * the seam empty rather than burn the user's data for zero hits. This is the
 * implementation that seam was waiting for.
 */
export const registerArtworkPrefetch = (): void => {
  setArtworkPrefetcher((ids) => {
    prefetchArtwork(ids);
  });
  if (subscribed) return;
  subscribed = true;
  queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" && event.type !== "added") return;
    const query = event.query as Query;
    if (query.state.status !== "success") return;
    if (!isHomeRailKey(query.queryKey)) return;
    const data = query.state.data;
    if (data && typeof data === "object") {
      if (handled.has(data)) return;
      handled.add(data);
    }
    warmHomeArtwork();
  });
};
