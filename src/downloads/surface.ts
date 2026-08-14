/**
 * The platform-neutral face of the downloads subsystem.
 *
 * The settings screens (features/downloads/overview.tsx, settings.tsx) used to
 * import `listDownloadedSongs`, `playCacheUsage`, `storageUsageFast`,
 * `downloadedPlaylists` and `listInFlight` straight out of
 * `downloads/manager.ts` - a module built on expo-sqlite plus
 * expo-file-system, i.e. native in spirit even where it imports on web. That
 * was fine while downloads existed on exactly one platform. There are three
 * now (native, the Tauri shell over the Rust cache, a plain browser tab with
 * no local store at all) and the screens must not learn which one they are on.
 *
 * So the screens ask HERE, and each platform installs its own implementation:
 *  - native: downloads/register.ts installs the manager-backed surface;
 *  - desktop shell: downloads/desktop/manager.ts installs the Rust-backed one;
 *  - plain web: nothing installs anything and the inert default below answers
 *    zeros and empty arrays, which is byte for byte what those screens
 *    rendered on web before this file existed.
 *
 * Every read is SYNCHRONOUS on purpose. The screens key them off the coarse
 * status version, which since the 2026-08-14 freeze report bumps on status
 * TRANSITIONS only; a promise here would turn each of those bumps into a
 * render, an await and a second render. The one genuinely slow read (the real
 * disk walk) keeps its own async name so it can never be mistaken for cheap.
 */
import type { Song } from "@/domain/song";
import type { SongKey } from "@/domain/ids";

/** Byte accounting. Always an SQL SUM, never a directory walk (invariant I2). */
export interface UsageTotals {
  bytes: number;
  files: number;
}

/** What the overview draws for a transfer that has not landed yet. */
export interface InFlightRow {
  songKey: SongKey;
  song: Song | null;
  status: "queued" | "downloading";
  progress: number;
}

/** A downloaded playlist as the overview lists it (name + cover + count). */
export interface OfflinePlaylistSummary {
  id: number;
  name: string;
  artworkMediaId: string | null;
  songCount: number;
  /** "liked" marks the liked mirror, which renders the heart tile instead. */
  sourceExternalId: string | null;
}

export interface DownloadsSurfaceOpts {
  includeStems?: boolean;
}

export interface DownloadsSurface {
  /** True when this platform has a local store at all (web: false). */
  available(): boolean;
  listDownloadedSongs(): Song[];
  downloadedPlaylists(): OfflinePlaylistSummary[];
  listInFlight(): InFlightRow[];
  /** Bytes the user explicitly downloaded: never evicted, never TTL-purged. */
  pinnedUsage(): UsageTotals;
  /** The orphan tier: play cache plus predictive guesses, both evictable. */
  evictableUsage(): UsageTotals;
  /** The REAL walk. Async, and named so, because it stats every file. */
  storageUsageSlow(): Promise<UsageTotals>;
  download(song: Song, opts?: DownloadsSurfaceOpts): Promise<void>;
  remove(id: number | string): Promise<void>;

  // -------------------------------------------------------------------------
  // The predictive tier's controls (owner D, additive on purpose).
  //
  // OPTIONAL, so a platform that has not wired them yet still satisfies the
  // interface and the screens degrade to hiding a number rather than lying
  // about one. The desktop shell can answer all three today - `cache_usage`
  // carries the budget and `cache_purge` empties the tier - it simply has not
  // been pointed at them yet.
  // -------------------------------------------------------------------------

  /** The ceiling `evictableUsage` is swept down to. Null = unknown here. */
  evictableBudget?(): number | null;
  /**
   * Waste instrumentation for the session: how many predicted bytes were
   * written and how many of those were evicted without ever being played.
   * Under 30 % is the target; without the ratio the ladder cannot be tuned.
   */
  predictiveWaste?(): { written: number; evictedUnplayed: number; ratio: number };
  /** Empties the evictable tier. Returns bytes freed. Pinned is untouched. */
  purgeEvictable?(): number | Promise<number>;
}

const EMPTY: UsageTotals = { bytes: 0, files: 0 };

/**
 * Plain web. Not a stub waiting to be filled in: a browser tab streams, and
 * every surface below answering "nothing" is the correct, permanent answer
 * there (plano "uma so app", F1).
 */
const inertSurface: DownloadsSurface = {
  available: () => false,
  listDownloadedSongs: () => [],
  downloadedPlaylists: () => [],
  listInFlight: () => [],
  pinnedUsage: () => EMPTY,
  evictableUsage: () => EMPTY,
  storageUsageSlow: async () => EMPTY,
  download: async () => {},
  remove: async () => {},
};

let current: DownloadsSurface = inertSurface;

export const setDownloadsSurface = (surface: DownloadsSurface): void => {
  current = surface;
};

export const getDownloadsSurface = (): DownloadsSurface => current;

/** Exported for the test that proves plain web is unchanged. */
export const getInertDownloadsSurface = (): DownloadsSurface => inertSurface;
