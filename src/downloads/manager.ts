/**
 * Download manager (DESIGN 9.2): the singleton orchestrating the frozen DDL,
 * the transfer scheduler and the in-memory status/local-file indexes. One
 * active session per signed-in user (per-user db + per-user directory);
 * account switching is start()/stop(), no shared-store purge logic.
 *
 * Bundle rules (FR-83): mixed (compressed || original node), mixed_original
 * (only when the original differs from the compressed), artwork
 * (compressed-first), vocal/instrumental when includeStems and the ids
 * exist; the full Song JSON lands in dl_songs BEFORE any bytes; lyrics are
 * fetched best-effort into the FR-81 tri-state. Jam songs are refused
 * entirely (one of the three independent jam guards).
 */
import NetInfo from "@react-native-community/netinfo";
import { File, type Directory } from "expo-file-system";
import type { SQLiteDatabase } from "expo-sqlite";
import { getLyrics } from "@/api/endpoints/lyrics";
import { closeUserDb, openUserDb } from "@/db/index";
import { kvGet, kvSet } from "@/db/kv";
import { clearRecentCollections } from "@/lib/recentCollections";
import { isApiError } from "@/domain/api";
import type { DownloadEntry, DownloadKind, LyricsState, SongDownloadStatus } from "@/domain/downloads";
import type { FsNodeId, SongKey, UserId } from "@/domain/ids";
import { toSongId, toSongKey } from "@/domain/ids";
import type { Lyrics } from "@/domain/lyrics";
import type { Song } from "@/domain/song";
import { ArtworkNodeIndex } from "./artworkIndex";
import * as repo from "./db";
import { LyricsFetchQueue } from "./lyricsQueue";
import {
  downloadsRootDirectory,
  ensureUserDownloadDirectory,
  filenameFor,
  walkDirectoryBytes,
} from "./paths";
import { getDownloadSettings } from "./settings";
import {
  clearKindStatus,
  clearSongStatuses,
  getKindStatus,
  getMixedProgress,
  getMixedStatus,
  resetStatuses,
  setKindStatus,
  subscribeDownloadStatus,
} from "./status";
import { TransferScheduler, type TransferRequest } from "./tasks";

/** Enqueue-time WiFi refusal (FR-88). UI copy resolves through i18n. */
export class WifiRefusedError extends Error {
  readonly i18nKey = "native.downloads.noWifiRefused";
  constructor() {
    super("No WiFi - download refused.");
    this.name = "WifiRefusedError";
  }
}

export const isWifiRefusedError = (e: unknown): e is WifiRefusedError =>
  e instanceof WifiRefusedError;

interface ActiveSession {
  userId: UserId;
  db: SQLiteDatabase;
  dir: Directory;
  scheduler: TransferScheduler;
  collections: Set<string>;
  localIndex: Map<string, string>; // "key::kind" -> file uri
  /** fs node id -> song key, so bare-node artwork resolves offline (FR-91). */
  artworkNodes: ArtworkNodeIndex;
  /**
   * Parsed dl_songs rows kept in memory: the Downloads screen and the offline
   * library resolvers read the whole library on every coarse status bump, and
   * re-parsing hundreds of Song JSON blobs at 4 Hz is exactly the re-render
   * storm FR-82 exists to avoid. SQLite stays the source of truth; this is a
   * write-through mirror.
   */
  songs: Map<SongKey, repo.StoredSong>;
  closed: boolean;
}

const indexKey = (songKey: SongKey, kind: DownloadKind): string => `${songKey}::${kind}`;

/** Below this, a "completed" file is an error body, not media (see below). */
const MIN_PLAUSIBLE_FILE_BYTES = 1024;

/** Normalizes number|string song ids through the ONE legal converter. */
export const normalizeSongKey = (id: number | string): SongKey =>
  typeof id === "number" ? toSongKey(id) : toSongKey(toSongId(id));

/**
 * The file/kv half of the media-id wipe (schema v5 drops the tables): the
 * downloaded bytes on disk and the persisted recent-collections entries were
 * addressed by fs node UUIDs, which no longer resolve against `/media`. Runs
 * once per device, on the first session start after the update, and deletes
 * the WHOLE downloads root (every user: all their ids are equally stale;
 * each user's tables are wiped by their own db migration on open). Users
 * re-download; a stale UUID can never be replayed against `/media`.
 */
const MEDIA_WIPE_KV_KEY = "oms-music.downloads.media-id-wipe";

const wipeLegacyNodeArtifactsOnce = (): void => {
  if (kvGet(MEDIA_WIPE_KV_KEY) === "1") return;
  try {
    const root = downloadsRootDirectory();
    if (root.exists) root.delete();
  } catch {
    // Best-effort: orphan files cost disk, never correctness (the tables that
    // pointed at them are gone), and ensureUserDownloadDirectory recreates.
  }
  clearRecentCollections();
  kvSet(MEDIA_WIPE_KV_KEY, "1");
};

let active: ActiveSession | null = null;
const startListeners = new Set<() => void>();
/** One paced lyrics backfill queue for the process (see lyricsQueue.ts). */
const lyricsQueue = new LyricsFetchQueue();

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export const isStarted = (): boolean => active != null;

export const currentUserId = (): UserId | null => active?.userId ?? null;

/** Fires whenever a session starts (register wires repair to it). */
export const onManagerStarted = (cb: () => void): (() => void) => {
  startListeners.add(cb);
  return () => {
    startListeners.delete(cb);
  };
};

export const startManager = (userId: UserId): void => {
  if (active?.userId === userId) return;
  if (active) stopManager();

  const db = openUserDb(userId);
  wipeLegacyNodeArtifactsOnce();
  const dir = ensureUserDownloadDirectory(userId);

  const session: ActiveSession = {
    userId,
    db,
    dir,
    scheduler: null as unknown as TransferScheduler,
    collections: new Set(repo.listCollections(db)),
    localIndex: new Map(),
    artworkNodes: new ArtworkNodeIndex(),
    songs: new Map(repo.listStoredSongs(db).map((row) => [row.songKey, row])),
    closed: false,
  };
  for (const stored of session.songs.values()) {
    session.artworkNodes.add(stored.songKey, stored.song);
  }

  // Stale play-cache entries go BEFORE hydration, so the re-attach loop
  // below never resumes a transfer the purge just deleted.
  purgeStaleCache(session);

  const progressDbSteps = new Map<string, number>();

  session.scheduler = new TransferScheduler({
    onStarted: (req, savableJson) => {
      if (session.closed) return;
      repo.setFileStatus(session.db, req.songKey, req.kind, "downloading");
      repo.setFileSavable(session.db, req.songKey, req.kind, savableJson);
      const prev = getKindStatus(req.songKey, req.kind);
      setKindStatus(req.songKey, req.kind, "downloading", prev?.progress ?? 0);
    },
    onProgress: (req, progress) => {
      if (session.closed) return;
      setKindStatus(req.songKey, req.kind, "downloading", progress);
      // The row write is stepped (5%) so chunk events never thrash SQLite.
      const key = indexKey(req.songKey, req.kind);
      const step = Math.floor(progress * 20);
      if (progressDbSteps.get(key) !== step) {
        progressDbSteps.set(key, step);
        repo.setFileProgress(session.db, req.songKey, req.kind, progress);
      }
    },
    onComplete: (req, file) => {
      if (session.closed) return;
      let size = 0;
      try {
        size = file.size ?? 0;
      } catch {
        size = 0;
      }
      // A stale token makes /media/:id/data answer 404 with a bare JSON
      // string; some native stacks write that body to disk and "complete".
      // No real media file is that small, so treat it as an error and let
      // repair re-enqueue with a fresh URL instead of storing a poison file.
      if (size < MIN_PLAUSIBLE_FILE_BYTES) {
        try {
          file.delete();
        } catch {
          // Nothing to clean up.
        }
        repo.setFileStatus(session.db, req.songKey, req.kind, "error", "Empty response");
        repo.setFileSavable(session.db, req.songKey, req.kind, null);
        progressDbSteps.delete(indexKey(req.songKey, req.kind));
        setKindStatus(req.songKey, req.kind, "error", 0);
        return;
      }
      repo.markFileDone(session.db, req.songKey, req.kind, file.uri, size);
      session.localIndex.set(indexKey(req.songKey, req.kind), file.uri);
      progressDbSteps.delete(indexKey(req.songKey, req.kind));
      setKindStatus(req.songKey, req.kind, "done", 1);
    },
    onError: (req, message) => {
      if (session.closed) return;
      repo.setFileStatus(session.db, req.songKey, req.kind, "error", message);
      repo.setFileSavable(session.db, req.songKey, req.kind, null);
      progressDbSteps.delete(indexKey(req.songKey, req.kind));
      setKindStatus(req.songKey, req.kind, "error", 0);
    },
    onCancelled: (req) => {
      if (session.closed) return;
      const row = repo.getFile(session.db, req.songKey, req.kind);
      if (row && row.status !== "done") {
        // Keep the row queued so the next boot / repair pass resumes it.
        repo.setFileStatus(session.db, req.songKey, req.kind, "queued");
        setKindStatus(req.songKey, req.kind, "queued", 0);
      } else if (!row) {
        clearKindStatus(req.songKey, req.kind);
      }
    },
  });

  // Hydrate the status map + local index, re-attach persisted transfers.
  for (const row of repo.listAllFiles(db)) {
    if (row.status === "done") {
      setKindStatus(row.song_key, row.kind, "done", 1);
      // NEVER trust the stored absolute local_uri: iOS moves the app
      // container on every install/update, so it points at the PREVIOUS
      // container and every "downloaded" song silently fell through the
      // ladder to the network stream (owner report 2026-08-11). The
      // filename resolved against the CURRENT directory is the truth; a
      // file that is genuinely gone stays out of the index and repair
      // re-downloads it.
      try {
        const file = new File(session.dir, row.filename);
        if (file.exists) {
          session.localIndex.set(indexKey(row.song_key, row.kind), file.uri);
        }
      } catch {
        // Unreadable entry: treat as not resident.
      }
    } else if (row.status === "error") {
      setKindStatus(row.song_key, row.kind, "error", 0);
    } else {
      // queued/downloading from a previous run: savable re-attach when we
      // have one, fresh re-enqueue otherwise (FR-84 boot heal).
      setKindStatus(row.song_key, row.kind, "queued", 0);
      const req = requestForRow(session, row);
      if (row.savable) {
        session.scheduler.reattach(req, row.savable);
      } else {
        session.scheduler.enqueue(req);
      }
    }
  }

  active = session;
  for (const cb of startListeners) cb();
};

export const stopManager = (): void => {
  const session = active;
  if (!session) return;
  session.closed = true;
  active = null;
  session.scheduler.cancelAll();
  lyricsQueue.clear();
  session.localIndex.clear();
  session.artworkNodes.clear();
  session.collections.clear();
  session.songs.clear();
  resetStatuses();
  closeUserDb(session.userId);
};

// ---------------------------------------------------------------------------
// Reads (sync, FR-82)
// ---------------------------------------------------------------------------

export const getStatusFor = (id: number | string): SongDownloadStatus => {
  if (!active) return "none";
  const songKey = normalizeSongKey(id);
  // Orphan mixed files (the play cache) must not light the "downloaded"
  // badge or flip the song menu to "remove": only a song the USER downloaded
  // (dl_songs row) reports a status.
  if (!active.songs.has(songKey)) return "none";
  return getMixedStatus(songKey);
};

export const getProgressFor = (id: number | string): number =>
  active ? getMixedProgress(normalizeSongKey(id)) : 0;

export { subscribeDownloadStatus };

/** LocalFileIndex read (contracts/localSource): done files only. */
export const localUriFor = (songKey: SongKey, kind: DownloadKind): string | null =>
  active?.localIndex.get(indexKey(songKey, kind)) ?? null;

/**
 * LocalFileIndex read for artwork quoted as a BARE fs node (album tiles,
 * artist grids, home rails): the reverse index answers which downloaded song
 * owns that node, and the file has to actually be on disk (FR-91).
 */
export const localArtworkUriForNode = (nodeId: FsNodeId): string | null => {
  const session = active;
  if (!session) return null;
  for (const songKey of session.artworkNodes.songKeysFor(nodeId)) {
    const uri = session.localIndex.get(indexKey(songKey, "artwork"));
    if (uri) return uri;
  }
  return null;
};

export const listStoredSongs = (): repo.StoredSong[] =>
  active ? [...active.songs.values()] : [];

export const getStoredSong = (songKey: SongKey): repo.StoredSong | null =>
  active?.songs.get(songKey) ?? null;

/** Downloaded library rows: songs whose `mixed` kind is done (FR-92). */
export const listDownloadedSongs = (): Song[] =>
  listStoredSongs()
    .filter((s) => getMixedStatus(s.songKey) === "done")
    .map((s) => s.song);

/** In-flight `mixed` transfers for the Downloads screen (FR-92). */
export const listInFlight = (): { songKey: SongKey; song: Song | null; status: "queued" | "downloading"; progress: number }[] => {
  if (!active) return [];
  const out: { songKey: SongKey; song: Song | null; status: "queued" | "downloading"; progress: number }[] = [];
  for (const stored of active.songs.values()) {
    const status = getKindStatus(stored.songKey, "mixed");
    if (!status) continue;
    if (status.status !== "queued" && status.status !== "downloading") continue;
    out.push({
      songKey: stored.songKey,
      song: stored.song,
      status: status.status,
      progress: status.progress,
    });
  }
  return out;
};

export const listOfflineCollections = (): ReadonlySet<string> =>
  active?.collections ?? new Set<string>();

export const isOfflineCollectionKey = (key: string): boolean =>
  active?.collections.has(key) ?? false;

export const addOfflineCollection = (key: string): void => {
  if (!active) return;
  active.collections.add(key);
  repo.addCollection(active.db, key);
};

export const removeOfflineCollection = (key: string): void => {
  if (!active) return;
  active.collections.delete(key);
  repo.removeCollection(active.db, key);
};

export const storageUsage = async (): Promise<{ bytes: number; files: number }> => {
  if (!active) return { bytes: 0, files: 0 };
  return walkDirectoryBytes(active.dir);
};

/** Offline lyrics read (FR-81): tri-state straight from the row. */
export const getStoredLyrics = (
  id: number | string,
): { state: LyricsState; lyrics: Lyrics | null } | null => {
  const stored = getStoredSong(normalizeSongKey(id));
  if (!stored) return null;
  return { state: stored.lyricsState, lyrics: stored.lyrics };
};

// ---------------------------------------------------------------------------
// Download / remove
// ---------------------------------------------------------------------------

const wifiGate = async (): Promise<void> => {
  if (!getDownloadSettings().wifiOnly) return;
  try {
    const state = await NetInfo.fetch();
    if (state.isConnected && state.type !== "wifi") throw new WifiRefusedError();
  } catch (error) {
    if (isWifiRefusedError(error)) throw error;
    // Probe failure: allow (DESIGN 9.2).
  }
};

const requestForRow = (session: ActiveSession, row: DownloadEntry): TransferRequest => ({
  songKey: row.song_key,
  kind: row.kind,
  nodeId: row.node_id,
  destUri: new File(session.dir, row.filename).uri,
});

const enqueueKind = (
  session: ActiveSession,
  song: Song,
  songKey: SongKey,
  kind: DownloadKind,
  nodeId: FsNodeId,
  opts: { siblingNodeId?: FsNodeId | null; usesCompressedNode: boolean },
): void => {
  // Dedup (FR-83/89): no-op when done or already scheduled here.
  if (getKindStatus(songKey, kind)?.status === "done") return;
  if (session.scheduler.has(songKey, kind)) return;

  const filename = filenameFor(songKey, kind, song, opts.usesCompressedNode);
  repo.upsertQueuedFile(session.db, {
    songKey,
    kind,
    nodeId,
    siblingNodeId: opts.siblingNodeId ?? null,
    filename,
  });
  setKindStatus(songKey, kind, "queued", 0);
  session.scheduler.enqueue({
    songKey,
    kind,
    nodeId,
    destUri: new File(session.dir, filename).uri,
  });
};

const fetchLyricsIntoRow = (session: ActiveSession, song: Song, songKey: SongKey): void => {
  // Best-effort and paced: `/lyrics` is a 60/min bucket and both drivers (a
  // bulk collection toggle, the whole-library repair pass) drain in
  // microtasks, so the queue is what keeps a 250-song toggle from opening
  // 250 concurrent requests. Failures keep the 'unfetched' state so repair
  // retries, while a confirmed miss is never refetched (FR-81).
  lyricsQueue.enqueue(songKey, async () => {
    if (session.closed) return;
    try {
      const lyrics = await getLyrics(song.id);
      if (session.closed) return;
      const empty = lyrics.synced == null && lyrics.plain == null;
      const state: LyricsState = empty ? "none" : "cached";
      const payload = empty ? null : lyrics;
      repo.setSongLyrics(session.db, songKey, state, payload);
      const cached = session.songs.get(songKey);
      if (cached) {
        session.songs.set(songKey, { ...cached, lyricsState: state, lyrics: payload });
      }
    } catch (error) {
      // Honor Retry-After instead of hammering the shared bucket (API.md 1).
      if (isApiError(error) && error.status === 429) {
        lyricsQueue.pauseFor((error.retryAfter ?? 60) * 1000);
      }
    }
  });
};

export interface DownloadOpts {
  includeStems?: boolean;
  /**
   * Batch loops (collection sync, repair) probe the gate ONCE via
   * `probeWifiGate` and skip the per-song NetInfo round-trip - hundreds of
   * native fetches per pass were part of the 2026-08-14 freeze report. The
   * transfers themselves still fail safely if WiFi drops mid-loop.
   */
  skipWifiGate?: boolean;
}

/** One enqueue-time gate check for a whole batch (throws WifiRefusedError). */
export const probeWifiGate = async (): Promise<void> => wifiGate();

/**
 * Enqueues the full bundle for a song. Throws WifiRefusedError on the
 * enqueue-time gate (never silently queues, FR-88).
 */
export const downloadSong = async (song: Song, opts?: DownloadOpts): Promise<void> => {
  const session = active;
  if (!session) throw new Error("Downloads unavailable: no signed-in session.");
  if (song.jam_song) return; // Jam guard: never persisted or downloaded.

  const mixedNode = song.compressed_audio_media_id || song.audio_media_id;
  if (!mixedNode) return; // Nothing downloadable.

  if (!opts?.skipWifiGate) await wifiGate();
  if (session.closed) return;

  const songKey = toSongKey(song.id);

  // Song JSON first (FR-83): the Downloads screen renders metadata before
  // any bytes arrive, and repair walks these rows. SKIPPED when the stored
  // payload is current (same server updated_at): the repair pass and the
  // keep-synced loops re-call this for every already-done song, and the
  // unconditional stringify+INSERT was measurable freeze fuel.
  const existing = session.songs.get(songKey) ?? null;
  const unchanged = !!existing && existing.song.updated_at === song.updated_at;
  if (!unchanged) {
    repo.upsertSong(session.db, songKey, song);
    if (existing) session.artworkNodes.remove(songKey, existing.song);
    session.artworkNodes.add(songKey, song);
    session.songs.set(songKey, {
      songKey,
      song,
      storedAt: Date.now(),
      lyricsState: existing?.lyricsState ?? "unfetched",
      lyrics: existing?.lyrics ?? null,
    });
  }
  if (!existing || existing.lyricsState === "unfetched") {
    fetchLyricsIntoRow(session, song, songKey);
  }

  const usesCompressed = mixedNode === song.compressed_audio_media_id;
  enqueueKind(session, song, songKey, "mixed", mixedNode, {
    usesCompressedNode: usesCompressed,
  });

  // Quality upgrade: the original master only when distinct (FR-83).
  if (song.audio_media_id && song.audio_media_id !== song.compressed_audio_media_id) {
    enqueueKind(session, song, songKey, "mixed_original", song.audio_media_id, {
      siblingNodeId: mixedNode,
      usesCompressedNode: false,
    });
  }

  const artworkNode = song.compressed_artwork_media_id || song.artwork_media_id;
  if (artworkNode) {
    enqueueKind(session, song, songKey, "artwork", artworkNode, {
      usesCompressedNode: artworkNode === song.compressed_artwork_media_id,
    });
  }

  const includeStems = opts?.includeStems ?? getDownloadSettings().includeStems;
  if (includeStems) {
    if (song.vocals_media_id) {
      enqueueKind(session, song, songKey, "vocal", song.vocals_media_id, {
        usesCompressedNode: false,
      });
    }
    if (song.instrumental_media_id) {
      enqueueKind(session, song, songKey, "instrumental", song.instrumental_media_id, {
        usesCompressedNode: false,
      });
    }
  }
};

/** How long an unplayed cache entry survives (freshness via touchFile). */
const PLAY_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The play-cache tier's footprint (settings overview): orphan audio rows -
 * dl_files with NO dl_songs row - summed from their recorded sizes.
 */
export const playCacheUsage = (): { bytes: number; files: number } => {
  const session = active;
  if (!session) return { bytes: 0, files: 0 };
  // One SQL aggregate, not a JS sweep over every row (freeze report).
  return repo.sumCacheFileBytes(session.db);
};

/**
 * Synchronous byte accounting from dl_files.size_bytes - the disk walk
 * (storageUsage) stats every file natively and belongs nowhere near a
 * render path; this is the read the overview keys on status transitions.
 */
export const storageUsageFast = (): { bytes: number; files: number } => {
  const session = active;
  if (!session) return { bytes: 0, files: 0 };
  return repo.sumDoneFileBytes(session.db);
};

/**
 * Play cache (owner request 2026-08-08): every song that starts playing gets
 * its mixed file onto disk in the ORPHAN tier - dl_files row, deliberately NO
 * dl_songs row, the exact shape downloadStemsForPlayback established. That
 * keeps it invisible to the Downloads screen, the offline library and the
 * repair walk, while the LocalFileIndex serves it to the source ladder (next
 * play is local) and to the EQ passthrough (the equalizer works on streamed
 * songs the moment the file lands). A later REAL download just writes the
 * dl_songs row and finds the file already done - promotion costs nothing.
 *
 * Silent by design: a WiFi-only refusal or any failure simply means no cache
 * this time; a background optimization never raises a notice.
 */
export const cachePlayback = async (song: Song): Promise<void> => {
  const session = active;
  if (!session || session.closed) return;
  if (song.jam_song) return; // Jam guard: ephemeral URLs, never persisted.
  const mixedNode = song.compressed_audio_media_id || song.audio_media_id;
  if (!mixedNode) return;

  const songKey = toSongKey(song.id);
  if (getKindStatus(songKey, "mixed")?.status === "done") {
    // Already resident. For a cache orphan, replaying is what keeps it alive
    // past the purge; a real download's clock is irrelevant.
    if (!session.songs.has(songKey)) repo.touchFile(session.db, songKey, "mixed");
    return;
  }

  try {
    await wifiGate();
  } catch (error) {
    if (isWifiRefusedError(error)) return;
    throw error;
  }
  if (session.closed) return;

  enqueueKind(session, song, songKey, "mixed", mixedNode, {
    usesCompressedNode: mixedNode === song.compressed_audio_media_id,
  });
};

/**
 * Deletes cache-tier audio (orphan mixed rows) not played for
 * PLAY_CACHE_TTL_MS. Runs at session start, before hydration re-attaches
 * transfers. User downloads (dl_songs row) are never touched.
 */
const purgeStaleCache = (session: ActiveSession): void => {
  const cutoff = Date.now() - PLAY_CACHE_TTL_MS;
  for (const row of repo.listAllFiles(session.db)) {
    if (row.kind !== "mixed" && row.kind !== "mixed_original") continue;
    if (session.songs.has(row.song_key)) continue;
    if (row.updated_at >= cutoff) continue;
    try {
      const uri = new File(session.dir, row.filename).uri;
      const file = new File(uri);
      if (file.exists) file.delete();
    } catch {
      // The file is already gone; the row still goes.
    }
    repo.deleteFile(session.db, row.song_key, row.kind);
  }
};

/**
 * Enqueues ONLY the two stem files, for the custom blend (DESIGN 16.1
 * amendment 2026-08-03): the native mixers play local files, so entering
 * custom mode for a song whose stems are not resident downloads them while
 * the plain mix keeps playing.
 *
 * Deliberately writes NO dl_songs row: a song heard once in custom mode must
 * not silently join the offline library, and verifyAndRepair walks dl_songs -
 * a row here would make the next repair pass pull the whole bundle. Orphan
 * dl_files rows are harmless: boot re-attach resumes them, removeDownload
 * deletes them, and getMixedStatus (the row badge) never sees them.
 */
export const downloadStemsForPlayback = async (song: Song): Promise<void> => {
  const session = active;
  if (!session) throw new Error("Downloads unavailable: no signed-in session.");
  if (song.jam_song) throw new Error("Jam songs have no stems.");
  const vocals = song.vocals_media_id;
  const instrumental = song.instrumental_media_id;
  if (!vocals || !instrumental) throw new Error("Song has no stems.");

  await wifiGate();
  if (session.closed) throw new Error("Downloads session closed.");

  const songKey = toSongKey(song.id);
  enqueueKind(session, song, songKey, "vocal", vocals, { usesCompressedNode: false });
  enqueueKind(session, song, songKey, "instrumental", instrumental, {
    usesCompressedNode: false,
  });
};

/** Removes every stored kind, the files on disk and the song row. */
export const removeDownload = async (id: number | string): Promise<void> => {
  const session = active;
  if (!session) return;
  const songKey = normalizeSongKey(id);
  session.scheduler.cancelSong(songKey);
  for (const row of repo.listFilesForSong(session.db, songKey)) {
    const uri = new File(session.dir, row.filename).uri;
    try {
      const file = new File(uri);
      if (file.exists) file.delete();
    } catch {
      // Missing file: nothing to delete.
    }
    session.localIndex.delete(indexKey(songKey, row.kind));
  }
  repo.deleteFilesForSong(session.db, songKey);
  repo.deleteStoredSong(session.db, songKey);
  const stored = session.songs.get(songKey);
  if (stored) session.artworkNodes.remove(songKey, stored.song);
  session.songs.delete(songKey);
  clearSongStatuses(songKey);
};

/**
 * Verify half of verify-and-repair (FR-89): drops `done` rows whose file
 * vanished so a subsequent download() re-enqueues them.
 */
export const verifySongFiles = (songKey: SongKey): void => {
  const session = active;
  if (!session) return;
  for (const row of repo.listFilesForSong(session.db, songKey)) {
    if (row.status !== "done") continue;
    const uri = new File(session.dir, row.filename).uri;
    let exists = false;
    try {
      exists = new File(uri).exists;
    } catch {
      exists = false;
    }
    if (!exists) {
      repo.deleteFile(session.db, songKey, row.kind);
      session.localIndex.delete(indexKey(songKey, row.kind));
      clearKindStatus(songKey, row.kind);
    }
  }
};

/** Rows currently in `error` state, grouped by song (repair input). */
export const listErroredSongKeys = (): SongKey[] => {
  if (!active) return [];
  const keys = new Set<SongKey>();
  for (const row of repo.listFilesByStatus(active.db, "error")) keys.add(row.song_key);
  return [...keys];
};

/**
 * Cache a downloaded playlist's identity so it can still be listed with no
 * network (schema v2). Called from the playlist screen while online; the row
 * is dropped when the collection is turned off.
 */
export const rememberOfflinePlaylist = (row: repo.OfflinePlaylistRow): void => {
  if (!active) return;
  repo.upsertOfflinePlaylist(active.db, row);
};

export const forgetOfflinePlaylist = (id: number): void => {
  if (!active) return;
  repo.deleteOfflinePlaylist(active.db, id);
};

/** Downloaded playlists, name and artwork included, for the offline resolver. */
export const downloadedPlaylists = (): repo.OfflinePlaylistRow[] =>
  active ? repo.listOfflinePlaylists(active.db) : [];

/** Persisted membership of an offline collection (schema v4). */
export const rememberCollectionMembership = (
  collectionKey: string,
  songKeys: readonly SongKey[],
): void => {
  if (!active) return;
  repo.replaceCollectionSongs(active.db, collectionKey, songKeys);
};

export const collectionSongKeys = (collectionKey: string): SongKey[] =>
  active ? repo.listCollectionSongKeys(active.db, collectionKey) : [];

export const forgetCollectionMembership = (collectionKey: string): void => {
  if (!active) return;
  repo.deleteCollectionSongs(active.db, collectionKey);
};
