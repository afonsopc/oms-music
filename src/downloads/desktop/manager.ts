/**
 * The desktop downloads manager: the same job `downloads/manager.ts` does on
 * native, over the Rust cache instead of expo-sqlite plus expo-file-system.
 *
 * What it owns:
 *  - the PINNED set (songs with a `songs` row in the Rust index). Exactly as
 *    on mobile, "pinned" is DERIVED and never stored twice: a row badge, the
 *    Downloads overview and the offline library all key on this set, so an
 *    orphan cache row - the play cache and the predictive tier - stays
 *    invisible to every one of them, for free;
 *  - the synchronous reads the screens make (status, progress, usage), warm in
 *    memory because they run inside renders;
 *  - the `DownloadsSurface` the settings screens consume;
 *  - the `PrefetchHost` that lets owner A's predictive driver run here
 *    unchanged.
 *
 * Everything asynchronous is fire and forget. A cache operation that fails
 * costs a stream instead of a local read, never a broken screen, so nothing
 * here raises a notice and nothing here blocks a render.
 */
import { getLyrics } from "@/api/endpoints/lyrics";
import { imageUrl } from "@/api/mediaUrl";
import type { DownloadKind, SongDownloadStatus } from "@/domain/downloads";
import type { MediaId, SongKey, UserId } from "@/domain/ids";
import { toSongId, toSongKey } from "@/domain/ids";
import type { Lyrics } from "@/domain/lyrics";
import type { Song } from "@/domain/song";
import type { PrefetchHost } from "@/prefetch/driver";
import type { PrefetchGates } from "@/prefetch/gates";
import { LyricsFetchQueue } from "../lyricsQueue";
import { NOTICE_KEYS, notifyDownloadNotice } from "../notices";
import { isManualOffline, isOnline } from "../offlineLibrary";
import { getDownloadSettings } from "../settings";
import { assertUnderStorageCap, isStorageCapError } from "../storageCap";
import {
  clearSongStatuses,
  getKindStatus,
  getMixedProgress,
  getMixedStatus,
  resetStatuses,
  setKindStatus,
} from "../status";
import type {
  DownloadsSurface,
  DownloadsSurfaceOpts,
  InFlightRow,
  OfflinePlaylistSummary,
  UsageTotals,
} from "../surface";
import {
  cacheCancel,
  cacheClose,
  cacheDownload,
  cacheListFiles,
  cacheListSongs,
  cacheLyricsGet,
  cacheLyricsSet,
  cacheOpen,
  cachePlaylistsList,
  cachePredict,
  cachePromote,
  cachePurge,
  cacheRemoveSong,
  cacheSetAuth,
  cacheUsage,
  type CacheEvent,
  type CacheUsage,
  type Want,
} from "./bridge";
import {
  applyLocalIndexStatus,
  forgetSongInLocalIndex,
  hydrateLocalIndex,
  isLocallyResident,
  noteWantedMediaId,
  resetLocalIndex,
} from "./localIndex";

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

interface DesktopSession {
  userId: UserId;
  origin: string;
  /** Pinned songs, parsed once. Rust stores the blobs and never reads them. */
  songs: Map<SongKey, Song>;
  usage: CacheUsage;
  /** The evictable ceiling Rust reported at open (10 GiB, or the override). */
  budgetBytes: number;
  playlists: OfflinePlaylistSummary[];
  closed: boolean;
}

let session: DesktopSession | null = null;
const EMPTY_USAGE: CacheUsage = {
  pinnedBytes: 0,
  pinnedFiles: 0,
  evictableBytes: 0,
  evictableFiles: 0,
};

/** One paced lyrics backfill queue for the process, same as native: `/lyrics`
 *  is a 60/min bucket and a collection toggle drains in microtasks. */
const lyricsQueue = new LyricsFetchQueue();

const parseSong = (json: string): Song | null => {
  try {
    return JSON.parse(json) as Song;
  } catch {
    return null; // Corrupt blob: skip. The next download rewrites it.
  }
};

const normalizeSongKey = (id: number | string): SongKey =>
  typeof id === "number" ? toSongKey(id) : toSongKey(toSongId(id));

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export const isDesktopCacheOpen = (): boolean => session != null && !session.closed;

export const desktopCacheOrigin = (): string => session?.origin ?? "";

export const desktopCacheUserId = (): UserId | null => session?.userId ?? null;

const startListeners = new Set<() => void>();

/** Fires once the cache session is usable (the collections hydrate on it). */
export const onDesktopCacheOpen = (cb: () => void): (() => void) => {
  startListeners.add(cb);
  return () => {
    startListeners.delete(cb);
  };
};

/**
 * Opens (or reopens) the per-user cache. `apiBase` and `token` are handed over
 * as parameters and never persisted on the Rust side: without them Rust cannot
 * build `/media/:id/data?token=` and no transfer can happen at all.
 *
 * Returns false when the shell has no working media protocol - Linux, where
 * WebKitGTK cannot play media from a custom URI scheme (WebKit bug 146351).
 * The caller then installs nothing and the app streams, exactly like a tab.
 */
export const openDesktopCache = async (
  userId: UserId,
  apiBase: string,
  token: string | null,
): Promise<boolean> => {
  if (session && session.userId === userId && !session.closed) return true;
  if (session) await closeDesktopCache();

  const opened = await cacheOpen(userId, apiBase, token);
  if (!opened.available) return false;

  const next: DesktopSession = {
    userId,
    origin: opened.origin,
    songs: new Map(),
    usage: EMPTY_USAGE,
    budgetBytes: opened.budgetBytes,
    playlists: [],
    closed: false,
  };
  session = next;

  const [songs, files] = await Promise.all([cacheListSongs(), cacheListFiles()]);
  if (next.closed) return false;
  for (const json of songs) {
    const song = parseSong(json);
    if (song) next.songs.set(toSongKey(song.id), song);
  }
  hydrateLocalIndex(opened.origin, files);
  // Hydrate the status map from the rows, so a badge is correct in the FIRST
  // frame rather than after the first event. Same shape as the native manager's
  // hydrate loop, and the coarse channel coalesces the whole burst into one
  // notify window.
  for (const file of files) {
    setKindStatus(
      file.songKey as SongKey,
      file.kind,
      file.status,
      file.status === "done" ? 1 : file.progress,
    );
  }
  await refreshUsage();
  await refreshPlaylists();
  for (const cb of startListeners) cb();
  return true;
};

export const closeDesktopCache = async (): Promise<void> => {
  const current = session;
  if (!current) return;
  current.closed = true;
  session = null;
  resetStatuses();
  resetLocalIndex();
  lyricsQueue.clear();
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  try {
    await cacheClose();
  } catch {
    // Closing is best-effort: the process may already be tearing down.
  }
};

/** Token rotation. Skipping it turns every later transfer into a 404. */
export const updateDesktopCacheAuth = (apiBase: string, token: string | null): void => {
  if (!session) return;
  void cacheSetAuth(apiBase, token).catch(() => undefined);
};

// ---------------------------------------------------------------------------
// Warm reads, refreshed off the event stream
// ---------------------------------------------------------------------------

const refreshUsage = async (): Promise<void> => {
  const current = session;
  if (!current) return;
  try {
    const usage = await cacheUsage();
    if (!current.closed) current.usage = usage;
  } catch {
    // Keep the previous totals; a stale number beats a blank screen.
  }
};

const refreshPlaylists = async (): Promise<void> => {
  const current = session;
  if (!current) return;
  try {
    const rows = await cachePlaylistsList();
    if (current.closed) return;
    current.playlists = rows.map((row) => ({
      id: row.id,
      name: row.name,
      artworkMediaId: row.artworkMediaId,
      songCount: row.songCount,
      sourceExternalId: row.sourceExternalId,
    }));
  } catch {
    // Same reasoning.
  }
};

/**
 * Rust evicts, TTL-purges and self-heals on its own timetable and announces
 * none of it (those rows light no badge, so an event per eviction would be
 * pure IPC noise). A debounced re-read is what keeps the warm map from
 * claiming bytes that are gone, and it is also where the byte totals the
 * overview draws get refreshed.
 *
 * Debounced hard: a 250-song collection sync lands dozens of transitions in a
 * burst and the answer only needs computing once they settle.
 */
const REFRESH_DEBOUNCE_MS = 4_000;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

export const scheduleDesktopRefresh = (): void => {
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    const current = session;
    if (!current || current.closed) return;
    void (async () => {
      try {
        const files = await cacheListFiles();
        if (!current.closed) hydrateLocalIndex(current.origin, files);
      } catch {
        // Keep the warm map; the protocol 404s a vanished file anyway.
      }
      await refreshUsage();
    })();
  }, REFRESH_DEBOUNCE_MS);
};

// ---------------------------------------------------------------------------
// Reads (synchronous, render-safe)
// ---------------------------------------------------------------------------

/**
 * A song reports a status only when the USER downloaded it. Orphan cache rows
 * - the play cache and the predictive tier - answer "none" here, which is what
 * keeps a prefetch from lighting a downloaded badge or flipping the song menu
 * to "remover". Same rule, same one-line shape as the native manager.
 */
export const getStatusFor = (id: number | string): SongDownloadStatus => {
  if (!session) return "none";
  const songKey = normalizeSongKey(id);
  if (!session.songs.has(songKey)) return "none";
  return getMixedStatus(songKey);
};

export const getProgressFor = (id: number | string): number =>
  session ? getMixedProgress(normalizeSongKey(id)) : 0;

export const listDownloadedSongs = (): Song[] => {
  if (!session) return [];
  const out: Song[] = [];
  for (const [songKey, song] of session.songs) {
    if (getMixedStatus(songKey) === "done") out.push(song);
  }
  return out;
};

export const getStoredSong = (songKey: SongKey): Song | null =>
  session?.songs.get(songKey) ?? null;

export const listInFlight = (): InFlightRow[] => {
  if (!session) return [];
  const out: InFlightRow[] = [];
  for (const [songKey, song] of session.songs) {
    const status = getKindStatus(songKey, "mixed");
    if (!status) continue;
    if (status.status !== "queued" && status.status !== "downloading") continue;
    out.push({ songKey, song, status: status.status, progress: status.progress });
  }
  return out;
};

const pinnedUsage = (): UsageTotals => ({
  bytes: session?.usage.pinnedBytes ?? 0,
  files: session?.usage.pinnedFiles ?? 0,
});

const evictableUsage = (): UsageTotals => ({
  bytes: session?.usage.evictableBytes ?? 0,
  files: session?.usage.evictableFiles ?? 0,
});

export const downloadedPlaylists = (): OfflinePlaylistSummary[] =>
  session?.playlists ?? [];

// ---------------------------------------------------------------------------
// Download / remove
// ---------------------------------------------------------------------------

/** The bundle rules, identical to FR-83 on native: mixed (compressed first),
 *  the original master only when it is a DIFFERENT id, artwork, and the two
 *  stems when the setting asks for them. */
const wantsFor = (song: Song, includeStems: boolean): Want[] => {
  const wants: Want[] = [];
  const mixed = song.compressed_audio_media_id || song.audio_media_id;
  if (!mixed) return wants;
  wants.push({ kind: "mixed", mediaId: mixed });
  if (song.audio_media_id && song.audio_media_id !== song.compressed_audio_media_id) {
    wants.push({ kind: "mixed_original", mediaId: song.audio_media_id });
  }
  const artwork = song.compressed_artwork_media_id || song.artwork_media_id;
  if (artwork) wants.push({ kind: "artwork", mediaId: artwork });
  if (includeStems) {
    if (song.vocals_media_id) wants.push({ kind: "vocal", mediaId: song.vocals_media_id });
    if (song.instrumental_media_id) {
      wants.push({ kind: "instrumental", mediaId: song.instrumental_media_id });
    }
  }
  return wants;
};

/**
 * Best-effort offline lyrics for a song the user pinned (the FR-81 write
 * half). Paced through the shared queue rather than fired inline: a 250-song
 * collection toggle would otherwise open 250 concurrent requests against a
 * 60/min bucket.
 */
const backfillLyrics = (songKey: SongKey, song: Song): void => {
  lyricsQueue.enqueue(songKey, async () => {
    const current = session;
    if (!current || current.closed) return;
    try {
      const existing = await cacheLyricsGet(songKey);
      if (existing && existing.state !== "unfetched") return;
      const lyrics = await getLyrics(song.id);
      if (current.closed) return;
      const empty = lyrics.synced == null && lyrics.plain == null;
      await cacheLyricsSet(
        songKey,
        empty ? "none" : "cached",
        empty ? null : JSON.stringify(lyrics),
      );
    } catch {
      // Leaving the row 'unfetched' is the retry: the next download tries again.
    }
  });
};

export const downloadSong = async (
  song: Song,
  opts?: DownloadsSurfaceOpts,
): Promise<void> => {
  const current = session;
  if (!current || current.closed) return;
  // Jam guard #1 of three: proposals carry ephemeral presigned URLs and no
  // media ids at all, so they are never persisted anywhere.
  if (song.jam_song || song.audio_url) return;

  // Storage cap (FR-94), a mesma regra do manager nativo: total local >= a
  // quota de música da conta recusa o enfileiramento novo. Lança, como no
  // nativo, e quem fala com o utilizador (a surface, o loop de colecções)
  // traduz para o aviso - uma vez, nunca uma vez por música.
  assertUnderStorageCap(current.usage.pinnedBytes + current.usage.evictableBytes);

  const includeStems = opts?.includeStems ?? getDownloadSettings().includeStems;
  const wants = wantsFor(song, includeStems);
  if (wants.length === 0) return;

  const songKey = toSongKey(song.id);
  // The pin lands in memory FIRST, so the badge and the song menu answer
  // correctly in the same frame as the click. Rust writes the same row.
  current.songs.set(songKey, song);
  for (const want of wants) noteWantedMediaId(songKey, want.kind, want.mediaId);
  // Optimistic queued for the row the UI watches. Rust's own `queued` arrives
  // milliseconds later and, being the SAME status, rides the progress channel
  // instead of bumping the coarse one a second time.
  if (getKindStatus(songKey, "mixed") == null) setKindStatus(songKey, "mixed", "queued", 0);

  try {
    await cacheDownload(songKey, JSON.stringify(song), wants);
  } catch {
    // The enqueue itself failed (no session in Rust, bad json). Undo the pin
    // rather than leave a song claiming to be downloaded forever.
    current.songs.delete(songKey);
    clearSongStatuses(songKey);
    return;
  }
  backfillLyrics(songKey, song);
};

export const removeDownload = async (id: number | string): Promise<void> => {
  const current = session;
  if (!current) return;
  const songKey = normalizeSongKey(id);
  current.songs.delete(songKey);
  forgetSongInLocalIndex(songKey);
  clearSongStatuses(songKey);
  try {
    await cacheRemoveSong(songKey);
  } catch {
    // The row survives; the next open re-reads it and the song comes back.
  }
  await refreshUsage();
};

/** Offline lyrics read (FR-81) for the desktop resolver. */
export const getStoredLyrics = async (
  id: number | string,
): Promise<{ state: string; lyrics: Lyrics | null } | null> => {
  if (!session) return null;
  try {
    const row = await cacheLyricsGet(normalizeSongKey(id));
    if (!row) return null;
    return {
      state: row.state,
      lyrics: row.json ? (JSON.parse(row.json) as Lyrics) : null,
    };
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// Playback promotion
// ---------------------------------------------------------------------------

/**
 * The desktop half of `cachePlayback`'s promotion: a probationary row the user
 * actually played stops being first in line for eviction. One UPDATE, at a
 * point we were already writing.
 *
 * There is no desktop equivalent of the native play-cache DOWNLOAD (a browser
 * that is already streaming the file gains nothing from a second copy of the
 * same bytes over the same connection); promotion of a row the predictive tier
 * already wrote is the part that matters.
 */
export const promotePlayback = (songKey: SongKey): void => {
  if (!session) return;
  if (!isLocallyResident(songKey, "mixed")) return;
  void cachePromote(songKey).catch(() => undefined);
};

// ---------------------------------------------------------------------------
// Event sink
// ---------------------------------------------------------------------------

/**
 * Called by events.ts for every event, AFTER status.ts has already been
 * updated. Progress samples are ignored here on purpose: they change no
 * residency and answer no question this module holds, and touching anything
 * per sample is how a 1 Hz channel turns back into a storm.
 */
export const noteCacheEvent = (event: CacheEvent): void => {
  if (event.type !== "status") return;
  applyLocalIndexStatus(event.songKey as SongKey, event.kind, event.status);
  if (event.status === "done" || event.status === "error") scheduleDesktopRefresh();
};

// ---------------------------------------------------------------------------
// The DownloadsSurface
// ---------------------------------------------------------------------------

export const desktopDownloadsSurface: DownloadsSurface = {
  available: () => isDesktopCacheOpen(),
  listDownloadedSongs,
  downloadedPlaylists,
  listInFlight,
  pinnedUsage,
  evictableUsage,
  // There is no walk on desktop: SQLite already knows every size, so the
  // "slow" read is the same SUM the fast ones use. Kept async so the screens
  // need no platform branch.
  storageUsageSlow: async () => {
    await refreshUsage();
    const pinned = pinnedUsage();
    const evictable = evictableUsage();
    return {
      bytes: pinned.bytes + evictable.bytes,
      files: pinned.files + evictable.files,
    };
  },
  // Nunca rejeita (paridade com a surface nativa): a recusa do cap (FR-94)
  // sai pelo canal de avisos, para os `void surface.download(song)` não
  // produzirem rejeições por tratar.
  download: async (song, opts) => {
    try {
      await downloadSong(song, opts);
    } catch (error) {
      if (isStorageCapError(error)) {
        notifyDownloadNotice(NOTICE_KEYS.storageCapRefused);
        return;
      }
      throw error;
    }
  },
  remove: removeDownload,
  evictableBudget: () => session?.budgetBytes ?? null,
  // No waste ratio here: Rust counts the predicted bytes it writes and evicts,
  // and the event stream deliberately carries no sizes. Reporting a number
  // this side could only invent would be worse than reporting none, so the
  // optional method stays unimplemented and the screen hides the row.
  purgeEvictable: async () => {
    const before = evictableUsage().bytes;
    try {
      const after = await cachePurge();
      if (session && !session.closed) session.usage = after;
      // Rust purges the tier and returns the totals; whatever the map still
      // claims about those files is now wrong, so re-read it too.
      scheduleDesktopRefresh();
      return Math.max(0, before - after.evictableBytes);
    } catch {
      return 0;
    }
  },
};

// ---------------------------------------------------------------------------
// The PrefetchHost (owner A's driver runs here unchanged)
// ---------------------------------------------------------------------------

/**
 * Browse artwork on desktop lives in the BROWSER's HTTP cache, not in the
 * media cache: the size disparity between a 40 KB cover and a 6 MB track is
 * two orders of magnitude, and letting them share one budget is how a scroll
 * through a big library evicts the audio. `/media/:id/data` already ships
 * Cache-Control, so warming a cover is one `new Image()` whose bytes the
 * later <img> reuses for free.
 */
const warmBrowseArtwork = (mediaIds: MediaId[]): void => {
  if (typeof window === "undefined") return;
  const ctor = (window as { Image?: new () => HTMLImageElement }).Image;
  if (typeof ctor !== "function") return;
  for (const mediaId of mediaIds) {
    try {
      const img = new ctor();
      // decoding=async keeps the warm-up off the main thread's paint path.
      img.decoding = "async";
      img.src = imageUrl(mediaId);
    } catch {
      // Bitmap warming is best-effort, always.
    }
  }
};

const inFlightKinds: readonly DownloadKind[] = [
  "mixed",
  "mixed_original",
  "artwork",
  "vocal",
  "instrumental",
];

/**
 * Transfers belonging to a song the user EXPLICITLY downloaded. Predictive
 * work is suspended entirely while any of these run - not queued behind them -
 * so the count, not a boolean, is what the gate reads.
 */
const explicitInFlight = (): number => {
  const current = session;
  if (!current) return 0;
  let count = 0;
  for (const songKey of current.songs.keys()) {
    for (const kind of inFlightKinds) {
      const status = getKindStatus(songKey, kind)?.status;
      if (status === "queued" || status === "downloading") count += 1;
    }
  }
  return count;
};

const gates = (): PrefetchGates => {
  const settings = getDownloadSettings();
  return {
    manualOffline: isManualOffline(),
    online: isOnline(),
    // A desktop is assumed unmetered: it has no cellular radio to bill and no
    // NetInfo to ask. The two WiFi flags stay off rather than being faked on,
    // so the truth table reads the same way it does on native.
    wifiOnly: false,
    onWifi: true,
    metered: false,
    // Rust owns the session waste ceiling (2 GiB) and enforces it inside
    // `cache_predict`, which is why that command returns a boolean. Claiming
    // it here as well would need byte counts the event stream deliberately
    // does not carry.
    sessionBudgetExhausted: false,
    explicitInFlight: explicitInFlight(),
    predictiveEnabled: settings.predictiveEnabled,
  };
};

export const desktopPrefetchHost: PrefetchHost = {
  // mixed_original counts as resident: the ladder serves it happily and
  // re-fetching the compressed mix on top of a master already on disk is pure
  // waste.
  resident: (songKey) =>
    isLocallyResident(songKey, "mixed") || isLocallyResident(songKey, "mixed_original"),
  inFlight: (songKey) => {
    const status = getKindStatus(songKey, "mixed")?.status;
    return status === "queued" || status === "downloading";
  },
  explicitInFlight,
  startAudio: (songKey: SongKey, mediaId: MediaId) => {
    noteWantedMediaId(songKey, "mixed", mediaId);
    // Rust may refuse (its own single-slot / suspension / budget rules). The
    // driver finds out on its next fire through `inFlight`, which is exactly
    // how it self-heals after any refusal.
    void cachePredict(songKey, mediaId).catch(() => undefined);
  },
  cancelAudio: (songKey: SongKey) => {
    // Never for a song the user actually downloaded: a supersede must not be
    // able to kill an explicit download that happens to share the key.
    if (session?.songs.has(songKey)) return;
    void cacheCancel(songKey, "mixed").catch(() => undefined);
  },
  progressOf: (songKey: SongKey) => getKindStatus(songKey, "mixed")?.progress ?? 0,
  prefetchArtwork: warmBrowseArtwork,
  gates,
  // Real byte counts never cross the IPC boundary (the event stream carries a
  // fraction, not a size), and Rust meters the session budget itself. A local
  // counter here would only be a second, wrong answer.
  noteBytes: () => {},
};
