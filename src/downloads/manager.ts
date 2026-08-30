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
import { File, Paths, type Directory } from "expo-file-system";
import type { SQLiteDatabase } from "expo-sqlite";
import { getLyrics } from "@/api/queries/lyrics";
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
import {
  evictableBudgetFor,
  planEviction,
  SESSION_PREDICTIVE_BUDGET_BYTES,
  type EvictableRow,
} from "./evict";
import { LyricsFetchQueue } from "./lyricsQueue";
import { isStaleForNode, mediaIdsChanged } from "./reconcile";
import {
  downloadsRootDirectory,
  ensureUserDownloadDirectory,
  filenameFor,
  walkDirectoryBytes,
} from "./paths";
import { getDownloadSettings } from "./settings";
import { assertUnderStorageCap } from "./storageCap";
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
  /**
   * "key::kind" entries this session enqueued PREDICTIVELY and that have not
   * completed yet. Only used to attribute completed bytes to the predictive
   * waste counter without a database read on the completion path.
   */
  predictive: Set<string>;
  /**
   * "key::kind" -> the media id the DONE file on disk was fetched from.
   *
   * A write-through mirror of dl_files.node_id for done rows only, and it
   * exists purely so the media-id reconciliation in enqueueKind costs a Map
   * lookup instead of a SELECT: repair walks the WHOLE library and calls
   * enqueueKind up to five times per song, so a row read there would be
   * thousands of synchronous queries per pass - the exact shape the
   * 2026-08-14 freeze report killed.
   */
  nodeIds: Map<string, FsNodeId>;
  /**
   * "key::kind" -> the filename of the file the media-id reconciliation is
   * REPLACING, kept until the replacement bytes are on disk.
   *
   * The reconciliation used to unlink first and fetch afterwards, so a repair
   * pass that started on a flaky link could drop N files and land zero: the
   * offline library grew holes for as long as the network stayed bad. Now the
   * old file survives under its old name (and keeps serving the player through
   * localIndex) while the new node id downloads under a name derived from that
   * id, and only `onComplete` unlinks the loser. Download-then-swap, never
   * swap-then-download.
   *
   * In-memory on purpose: a crash mid-replacement leaves the old file on disk
   * with no row pointing at it, which costs one file of disk and nothing else.
   * The alternative (a seventh schema migration to persist the loser's name)
   * buys a leak fix and risks the thing this map exists to protect.
   */
  superseded: Map<string, string>;
  /**
   * kind -> the "key::kind" the LocalFileIndex last handed to the player.
   *
   * The eviction sweep must never unlink the file backing playback RIGHT NOW.
   * On iOS and Android an open handle survives the unlink, but the engine
   * re-opens by path on the next load (and `purgeEvictable` drives the tier to
   * zero on a button press, with no LRU ordering to hide behind), so the file
   * being served has to be excluded explicitly. The Rust side already does
   * exactly this with `evict::plan`'s `keep` set; this is the mobile half of
   * the same guard.
   *
   * One entry per kind, so the map is bounded at five: the engine holds at most
   * a main file plus the two stems.
   */
  serving: Map<DownloadKind, string>;
  closed: boolean;
}

const indexKey = (songKey: SongKey, kind: DownloadKind): string => `${songKey}::${kind}`;

/**
 * True when a status write for this (song, kind) cannot change ANY rendered
 * output, so notifying is pure re-render cost (see status.ts `silent`).
 *
 * The predicate is deliberately narrow. An orphan `mixed`/`mixed_original` row
 * is the play cache and the predictive tier: `getStatusFor` returns "none"
 * without a dl_songs row, `listDownloadedSongs` and `listInFlight` walk
 * `session.songs`, and the repair walk walks dl_songs too - nothing can render
 * it. The STEM kinds are the opposite case and must keep notifying even when
 * orphaned: `stemProvision.waitForStems` drives the custom-blend progress off
 * the coarse channel, and silencing those rows would hang that wait forever.
 */
const isInvisibleRow = (
  session: ActiveSession,
  songKey: SongKey,
  kind: DownloadKind,
): boolean =>
  (kind === "mixed" || kind === "mixed_original") && !session.songs.has(songKey);

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

/**
 * Waste instrumentation for the predictive tier (design section 9). Both
 * counters are process-scoped and deliberately NOT persisted: they answer
 * "how much of what we guessed this session was thrown away unheard", and the
 * overview reports `evictedUnplayed / written`. Target under 30 %; without
 * the ratio there is no way to tune the ladder at all.
 */
let predictedBytesWritten = 0;
let predictedBytesEvictedUnplayed = 0;
/** Fed with REAL completed bytes; the prefetch host reads the budget back. */
let predictiveBytesListener: ((bytes: number) => void) | null = null;

export const setPredictiveBytesListener = (
  cb: ((bytes: number) => void) | null,
): void => {
  predictiveBytesListener = cb;
};

export const predictiveWaste = (): {
  written: number;
  evictedUnplayed: number;
  ratio: number;
} => ({
  written: predictedBytesWritten,
  evictedUnplayed: predictedBytesEvictedUnplayed,
  ratio: predictedBytesWritten > 0 ? predictedBytesEvictedUnplayed / predictedBytesWritten : 0,
});

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
    predictive: new Set<string>(),
    nodeIds: new Map<string, FsNodeId>(),
    superseded: new Map<string, string>(),
    serving: new Map<DownloadKind, string>(),
    closed: false,
  };
  for (const stored of session.songs.values()) {
    session.artworkNodes.add(stored.songKey, stored.song);
  }

  // Stale play-cache entries go BEFORE hydration, so the re-attach loop
  // below never resumes a transfer the purge just deleted.
  purgeStaleCache(session);
  // The byte budget on top of the TTL, and for the same reason it must run
  // here: eviction can never race a re-attach if it happens before the
  // hydrate loop exists to re-attach anything.
  evictToBudget(session);

  const progressDbSteps = new Map<string, number>();

  session.scheduler = new TransferScheduler({
    onStarted: (req, savableJson) => {
      if (session.closed) return;
      repo.setFileStatus(session.db, req.songKey, req.kind, "downloading");
      repo.setFileSavable(session.db, req.songKey, req.kind, savableJson);
      const prev = getKindStatus(req.songKey, req.kind);
      setKindStatus(
        req.songKey,
        req.kind,
        "downloading",
        prev?.progress ?? 0,
        isInvisibleRow(session, req.songKey, req.kind),
      );
    },
    onProgress: (req, progress) => {
      if (session.closed) return;
      setKindStatus(
        req.songKey,
        req.kind,
        "downloading",
        progress,
        isInvisibleRow(session, req.songKey, req.kind),
      );
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
        setKindStatus(
          req.songKey,
          req.kind,
          "error",
          0,
          isInvisibleRow(session, req.songKey, req.kind),
        );
        return;
      }
      repo.markFileDone(session.db, req.songKey, req.kind, file.uri, size);
      session.localIndex.set(indexKey(req.songKey, req.kind), file.uri);
      session.nodeIds.set(indexKey(req.songKey, req.kind), req.nodeId);
      progressDbSteps.delete(indexKey(req.songKey, req.kind));
      // The swap half of download-then-swap: the bytes that were being
      // REPLACED only die now that their replacement is on disk, so a repair
      // pass on a bad link can never leave the offline library with a hole.
      dropSupersededFile(session, req.songKey, req.kind, file.uri);
      setKindStatus(
        req.songKey,
        req.kind,
        "done",
        1,
        isInvisibleRow(session, req.songKey, req.kind),
      );

      // Predictive accounting + the per-session waste ceiling. Real bytes,
      // measured at completion: the driver never guesses a size.
      if (session.predictive.delete(indexKey(req.songKey, req.kind))) {
        predictedBytesWritten += size;
        predictiveBytesListener?.(size);
      }
      // An orphan row just grew the evictable tier. Debounced, because a
      // collection sync lands dozens of these in a burst and the budget
      // question only needs answering once they settle.
      if (!session.songs.has(req.songKey)) scheduleEviction(session);
    },
    onError: (req, message) => {
      if (session.closed) return;
      session.predictive.delete(indexKey(req.songKey, req.kind));
      repo.setFileStatus(session.db, req.songKey, req.kind, "error", message);
      repo.setFileSavable(session.db, req.songKey, req.kind, null);
      progressDbSteps.delete(indexKey(req.songKey, req.kind));
      setKindStatus(
        req.songKey,
        req.kind,
        "error",
        0,
        isInvisibleRow(session, req.songKey, req.kind),
      );
    },
    onCancelled: (req) => {
      if (session.closed) return;
      session.predictive.delete(indexKey(req.songKey, req.kind));
      const silent = isInvisibleRow(session, req.songKey, req.kind);
      const row = repo.getFile(session.db, req.songKey, req.kind);
      if (row && row.status !== "done") {
        // Keep the row queued so the next boot / repair pass resumes it.
        repo.setFileStatus(session.db, req.songKey, req.kind, "queued");
        setKindStatus(req.songKey, req.kind, "queued", 0, silent);
      } else if (!row) {
        clearKindStatus(req.songKey, req.kind, silent);
      }
    },
  });

  // Hydrate the status map + local index, re-attach persisted transfers.
  for (const row of repo.listAllFiles(db)) {
    if (row.status === "done") {
      setKindStatus(row.song_key, row.kind, "done", 1);
      // The media id these bytes came from, mirrored for the reconciliation
      // check (see ActiveSession.nodeIds).
      session.nodeIds.set(indexKey(row.song_key, row.kind), row.node_id);
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
  if (evictTimer) {
    clearTimeout(evictTimer);
    evictTimer = null;
  }
  session.localIndex.clear();
  session.nodeIds.clear();
  session.superseded.clear();
  session.serving.clear();
  session.artworkNodes.clear();
  session.collections.clear();
  session.songs.clear();
  session.predictive.clear();
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

/**
 * LocalFileIndex read (contracts/localSource): done files only.
 *
 * Handing a uri out is also the only moment the manager can know which file
 * the player is about to open, so the key is recorded as "serving" and the
 * eviction sweep skips it (see ActiveSession.serving). One slot per kind: a
 * newer answer for the same kind means the older one is no longer loaded.
 * Recording a candidate the ladder ends up not using is the harmless
 * direction - it protects one extra file until the next load.
 */
export const localUriFor = (songKey: SongKey, kind: DownloadKind): string | null => {
  const session = active;
  if (!session) return null;
  const key = indexKey(songKey, kind);
  const uri = session.localIndex.get(key) ?? null;
  if (uri) session.serving.set(kind, key);
  return uri;
};

/**
 * The "key::kind" entries the player currently has loaded. Read by the
 * eviction sweep, which must not unlink the file backing playback right now.
 */
export const servingKeys = (): ReadonlySet<string> =>
  new Set(active ? active.serving.values() : []);

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

/**
 * The filename a REPLACEMENT downloads into.
 *
 * It has to differ from the canonical one: the file being replaced is still on
 * disk and still serving the player, and writing the new bytes over it is the
 * swap-then-download hole this whole mechanism exists to close. Deriving the
 * suffix from the media id keeps it deterministic (a retry of the same
 * replacement reuses the same `.part`) and unique by construction, because the
 * only reason we are here is that this id differs from the stored one.
 */
const replacementFilenameFor = (
  songKey: SongKey,
  kind: DownloadKind,
  song: Song,
  usesCompressedNode: boolean,
  nodeId: FsNodeId,
): string => {
  const canonical = filenameFor(songKey, kind, song, usesCompressedNode);
  const dot = canonical.lastIndexOf(".");
  const stem = dot > 0 ? canonical.slice(0, dot) : canonical;
  const extension = dot > 0 ? canonical.slice(dot) : "";
  return `${stem}_${String(nodeId).replace(/[^0-9A-Za-z_-]/g, "")}${extension}`;
};

/**
 * Unlinks the file a landed replacement just superseded. Called from
 * `onComplete`, never before: that ordering IS the fix.
 */
const dropSupersededFile = (
  session: ActiveSession,
  songKey: SongKey,
  kind: DownloadKind,
  landedUri: string,
): void => {
  const key = indexKey(songKey, kind);
  const filename = session.superseded.get(key);
  if (!filename) return;
  session.superseded.delete(key);
  try {
    const file = new File(session.dir, filename);
    // Belt and braces: if the two names ever collided, deleting here would
    // delete the bytes we just downloaded.
    if (file.uri !== landedUri && file.exists) file.delete();
  } catch {
    // Already gone; nothing to reclaim.
  }
};

const enqueueKind = (
  session: ActiveSession,
  song: Song,
  songKey: SongKey,
  kind: DownloadKind,
  nodeId: FsNodeId,
  opts: {
    siblingNodeId?: FsNodeId | null;
    usesCompressedNode: boolean;
    /** Predictive tier: the row is probationary until playback promotes it. */
    predicted?: boolean;
  },
): void => {
  // Scheduler dedup FIRST. A transfer that is already queued or running for
  // this exact (song, kind) settles every question below - including a
  // replacement already in flight, whose row deliberately still advertises the
  // OLD node id until the new bytes land.
  if (session.scheduler.has(songKey, kind)) return;

  // Dedup (FR-83/89) plus media-id reconciliation, in one branch.
  //
  // Media ids are stable per CONTENT (replacing an attachment mints a NEW
  // id), so a DONE row whose node id differs from the id the current Song
  // payload wants is holding the wrong bytes: a re-transcoded song would
  // otherwise play its old master forever, because the dedup only ever
  // looked at the STATUS.
  //
  // The refetch is DOWNLOAD-THEN-SWAP. Unlinking first was the obvious
  // implementation and the wrong one: a repair walk that decides a hundred
  // rows are stale and then meets a flaky link would drop a hundred files and
  // land none, and the offline library would be full of holes until the
  // network came back. Instead the old file stays on disk, stays in
  // localIndex (so the player keeps playing local bytes throughout) and is
  // unlinked by `onComplete` once the replacement is safely written.
  //
  // The comparison reads the in-memory mirror rather than the row: only a
  // `done` row can be stale at all, and a SELECT here would run five times
  // per song on every repair walk.
  let superseded: string | null = null;
  if (getKindStatus(songKey, kind)?.status === "done") {
    const knownNode = session.nodeIds.get(indexKey(songKey, kind)) ?? null;
    // An unknown id is NOT treated as stale: dropping a good file because we
    // failed to remember where it came from would be the worse mistake.
    if (knownNode != null && isStaleForNode({ node_id: knownNode, status: "done" }, nodeId)) {
      superseded = repo.getFile(session.db, songKey, kind)?.filename ?? null;
    } else {
      return;
    }
  }

  const filename = superseded
    ? replacementFilenameFor(songKey, kind, song, opts.usesCompressedNode, nodeId)
    : filenameFor(songKey, kind, song, opts.usesCompressedNode);
  if (superseded && superseded !== filename) {
    session.superseded.set(indexKey(songKey, kind), superseded);
  }
  repo.upsertQueuedFile(session.db, {
    songKey,
    kind,
    nodeId,
    siblingNodeId: opts.siblingNodeId ?? null,
    filename,
    predicted: opts.predicted ?? false,
  });
  setKindStatus(songKey, kind, "queued", 0, isInvisibleRow(session, songKey, kind));
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

  // Storage cap (FR-94): total local >= quota de música da conta -> recusa
  // com explicação, nunca um enfileiramento silencioso. Antes do gate WiFi
  // porque a recusa mais específica é a que o utilizador consegue resolver.
  // sumDoneFileBytes é um SUM em SQL (invariante I2), nunca um walk do disco.
  assertUnderStorageCap(storageUsageFast().bytes);

  if (!opts?.skipWifiGate) await wifiGate();
  if (session.closed) return;

  const songKey = toSongKey(song.id);

  // Song JSON first (FR-83): the Downloads screen renders metadata before
  // any bytes arrive, and repair walks these rows. SKIPPED when the stored
  // payload is current (same server updated_at): the repair pass and the
  // keep-synced loops re-call this for every already-done song, and the
  // unconditional stringify+INSERT was measurable freeze fuel.
  //
  // The freshness test is `updated_at` AND the five media ids (owner D,
  // reconciliation): if the backend replaces an attachment without touching
  // the record, `updated_at` alone would call a payload with entirely new
  // media ids "unchanged", leaving dl_songs and the ArtworkNodeIndex pointing
  // at ids that no longer exist while the bytes we just re-fetched sat under
  // the new ones. Comparing the ids costs six string compares on a path that
  // otherwise does a JSON.stringify, so it is free where it matters.
  const existing = session.songs.get(songKey) ?? null;
  const unchanged =
    !!existing &&
    existing.song.updated_at === song.updated_at &&
    !mediaIdsChanged(existing.song, song);
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
    // past the purge; a real download's clock is irrelevant. It is ALSO the
    // promotion point (schema v6): a row the predictive tier wrote on a guess
    // stops being evicted-first the moment the guess turns out to be right.
    if (!session.songs.has(songKey)) repo.touchAndPromote(session.db, songKey, "mixed");
    return;
  }

  // Not resident yet, but a predictive transfer may be in flight for this
  // exact song right now. The user is listening, so clear the probationary
  // flag on the row the prefetcher wrote: waiting for the NEXT play would
  // leave a song that is actually being heard first in line for eviction.
  if (!session.songs.has(songKey)) {
    repo.setPredicted(session.db, songKey, "mixed", false);
    session.predictive.delete(indexKey(songKey, "mixed"));
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
 * The PREDICTIVE tier (owner request 2026-08-14). Exactly the same orphan
 * shape as cachePlayback - a dl_files row, deliberately NO dl_songs row - but
 * flagged `predicted = 1` so eviction takes it before anything the user has
 * actually heard. cachePlayback later clears the flag; a real download later
 * writes the dl_songs row and finds the file already there, so promotion in
 * either direction costs nothing.
 *
 * Silent by design, and gate-free HERE on purpose: every gate (GO OFFLINE,
 * WiFi, metered, session budget, explicit transfers in flight) was already
 * evaluated ONCE by the driver at fire time. Re-probing NetInfo per want is
 * precisely the per-song native round trip the 2026-08-14 freeze report
 * killed, and it would be re-introduced here in a shape that looked local and
 * innocent. The guards this keeps are the free, purely local ones.
 */
export const cachePredictive = (song: Song): void => {
  const session = active;
  if (!session || session.closed) return;
  if (song.jam_song || song.audio_url) return; // Jam guard: never persisted.
  const mixedNode = song.compressed_audio_media_id || song.audio_media_id;
  if (!mixedNode) return;

  const songKey = toSongKey(song.id);
  if (getKindStatus(songKey, "mixed")?.status === "done") return;

  session.predictive.add(indexKey(songKey, "mixed"));
  enqueueKind(session, song, songKey, "mixed", mixedNode, {
    usesCompressedNode: mixedNode === song.compressed_audio_media_id,
    predicted: true,
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
    // Runs before hydration today, so the mirrors are still empty - kept
    // symmetric anyway so a future caller cannot leave a ghost behind.
    session.localIndex.delete(indexKey(row.song_key, row.kind));
    session.nodeIds.delete(indexKey(row.song_key, row.kind));
  }
};

// ---------------------------------------------------------------------------
// Byte-budget eviction of the evictable tier
//
// The TTL alone was enough while playback was the only thing writing orphan
// rows. Predictive prefetch can fill a phone in a week, and a TTL is not a
// budget - so the budget sits ON TOP of the TTL, never replacing it.
//
// Everything here is SQL plus unlink. No disk walk, ever: `size_bytes` is
// written at completion and `Paths.availableDiskSpace` is a native property
// read, not a traversal (invariant I2 of the design).
// ---------------------------------------------------------------------------

/** Let a burst of completions settle before asking the budget question. */
const EVICT_DEBOUNCE_MS = 10_000;
let evictTimer: ReturnType<typeof setTimeout> | null = null;

const evictableBudget = (): number => {
  const override = getDownloadSettings().evictableBudgetBytes;
  if (override != null && Number.isFinite(override) && override >= 0) return override;
  let free = 0;
  try {
    free = Paths.availableDiskSpace;
  } catch {
    // No reading: fall back to the floor rather than to "unlimited".
    free = 0;
  }
  return evictableBudgetFor(free);
};

/**
 * Deletes worst-first until the evictable tier fits. Probationary rows go
 * first regardless of age; within a tier it is plain LRU on updated_at, which
 * touchFile/touchAndPromote already maintain. The FILE goes before the ROW:
 * an orphan file is recoverable (the startup sweep and repair find it), a
 * dangling row that claims bytes we no longer have is not.
 *
 * `budgetOverride` is what the settings screen's "limpar cache" passes as 0:
 * the same sweep, the same ordering, the same file-before-row discipline, so
 * a manual purge can never take a different (and therefore less tested) path
 * than the automatic one.
 */
const evictToBudget = (session: ActiveSession, budgetOverride?: number): void => {
  let rows: EvictableRow[];
  try {
    // listEvictableFiles already excludes pinned songs at the SQL level, so
    // `pinned` is false by construction here - the flag exists on the row
    // type so the pure planner can be tested with pinned rows present.
    rows = repo.listEvictableFiles(session.db).map((row) => ({
      songKey: row.song_key,
      kind: row.kind,
      sizeBytes: row.size_bytes,
      predicted: row.predicted ?? 0,
      updatedAt: row.updated_at,
      pinned: false,
    }));
  } catch {
    return; // A migration mid-flight; the next boot sweeps.
  }
  // Never unlink what the player has open right now. A play-cached or
  // predicted song is an orphan by construction, so LRU ordering is the only
  // thing that usually protects the current track - and `purgeEvictable`
  // passes a budget of 0, where ordering protects nothing at all.
  const plan = planEviction(
    rows,
    budgetOverride ?? evictableBudget(),
    new Set(session.serving.values()),
  );
  if (plan.evict.length === 0) return;

  for (const row of plan.evict) {
    const stored = repo.getFile(session.db, row.songKey, row.kind);
    if (stored) {
      try {
        const file = new File(session.dir, stored.filename);
        if (file.exists) file.delete();
      } catch {
        // Already gone; the row still goes.
      }
    }
    repo.deleteFile(session.db, row.songKey, row.kind);
    session.localIndex.delete(indexKey(row.songKey, row.kind));
    session.nodeIds.delete(indexKey(row.songKey, row.kind));
    session.superseded.delete(indexKey(row.songKey, row.kind));
    // Orphan `mixed` rows never light a badge (getStatusFor returns "none"
    // without a dl_songs row), so notifying here would re-render every mounted
    // badge and re-run the whole downloads overview to produce identical
    // output. Stem rows still notify: stemProvision waits on that channel.
    clearKindStatus(row.songKey, row.kind, isInvisibleRow(session, row.songKey, row.kind));
  }
  predictedBytesEvictedUnplayed += plan.predictedBytesFreed;
};

const scheduleEviction = (session: ActiveSession): void => {
  if (evictTimer) return;
  evictTimer = setTimeout(() => {
    evictTimer = null;
    if (session.closed) return;
    try {
      evictToBudget(session);
    } catch {
      // Never let a housekeeping sweep take the session down.
    }
  }, EVICT_DEBOUNCE_MS);
};

// ---------------------------------------------------------------------------
// Reads the predictive driver's host binds to (prefetch/register.ts)
// ---------------------------------------------------------------------------

/**
 * Transfers belonging to a song the user EXPLICITLY downloaded (a dl_songs
 * row exists). Predictive work is suspended entirely while any of these run,
 * which is why the count, not a boolean, is what the gate reads.
 */
export const explicitInFlight = (): number => {
  const session = active;
  if (!session) return 0;
  let count = 0;
  for (const entry of session.scheduler.entries()) {
    if (session.songs.has(entry.songKey)) count += 1;
  }
  return count;
};

/** True when the bytes are on disk AND the index can serve them. */
export const isResident = (songKey: SongKey, kind: DownloadKind): boolean =>
  active?.localIndex.has(indexKey(songKey, kind)) ?? false;

/** True when a transfer for this exact (song, kind) is queued or running. */
export const isTransferring = (songKey: SongKey, kind: DownloadKind): boolean =>
  active?.scheduler.has(songKey, kind) ?? false;

/**
 * Cancels a predictive audio transfer. Per (song, kind), never cancelSong,
 * and never for a song the user actually downloaded: a supersede must not be
 * able to kill an explicit download that happens to share the key.
 */
export const cancelPredictive = (songKey: SongKey): void => {
  const session = active;
  if (!session) return;
  if (session.songs.has(songKey)) return;
  session.scheduler.cancelKind(songKey, "mixed");
  session.predictive.delete(indexKey(songKey, "mixed"));
};

/**
 * The EVICTABLE tier's footprint. Identical to playCacheUsage - the play
 * cache and the predictive tier are the same orphan rows, which is the whole
 * point of section 1.2 - and kept as its own name so the settings screen can
 * say "evictable" without pretending it is a second tier.
 */
export const evictableUsage = (): { bytes: number; files: number } => playCacheUsage();

/**
 * Manual purge of the whole evictable tier (settings screen). Pinned songs
 * are untouched by construction - `listEvictableFiles` excludes anything with
 * a dl_songs row - so this can never eat the user's offline library, which is
 * exactly why the button can exist without a confirmation dialog beyond its
 * own label. Returns the bytes it freed so the screen can say so.
 */
export const purgeEvictable = (): number => {
  const session = active;
  if (!session) return 0;
  const before = playCacheUsage().bytes;
  evictToBudget(session, 0);
  return Math.max(0, before - playCacheUsage().bytes);
};

/** The byte ceiling the evictable tier is currently swept down to. */
export const evictableBudgetBytes = (): number => (active ? evictableBudget() : 0);

/** Session-scoped predictive budget the prefetch host meters against. */
export const predictiveSessionBudgetBytes = (): number => SESSION_PREDICTIVE_BUDGET_BYTES;

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
    // The row's own file, plus any file a replacement in flight was going to
    // supersede - the row no longer names that one, so nothing else would.
    const names = [row.filename, session.superseded.get(indexKey(songKey, row.kind))];
    for (const name of names) {
      if (!name) continue;
      try {
        const file = new File(session.dir, name);
        if (file.exists) file.delete();
      } catch {
        // Missing file: nothing to delete.
      }
    }
    session.localIndex.delete(indexKey(songKey, row.kind));
    session.nodeIds.delete(indexKey(songKey, row.kind));
    session.superseded.delete(indexKey(songKey, row.kind));
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
      session.nodeIds.delete(indexKey(songKey, row.kind));
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
