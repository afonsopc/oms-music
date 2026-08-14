/**
 * Repository over the frozen DDL (DESIGN 9.1): dl_songs / dl_files /
 * offline_collections in the per-user database. Song ids are normalized to
 * the ONE storage representation (string song_key) at this boundary (FR-85).
 * Pure SQL helpers; the manager owns the database handle and lifecycle.
 */
import type { SQLiteDatabase } from "expo-sqlite";
import type { DownloadEntry, DownloadFileStatus, DownloadKind, LyricsState } from "@/domain/downloads";
import type { FsNodeId, SongKey } from "@/domain/ids";
import type { Lyrics } from "@/domain/lyrics";
import type { Song } from "@/domain/song";

export interface StoredSongRow {
  song_key: SongKey;
  song_json: string;
  stored_at: number;
  lyrics_state: LyricsState;
  lyrics_json: string | null;
}

export interface StoredSong {
  songKey: SongKey;
  song: Song;
  storedAt: number;
  lyricsState: LyricsState;
  lyrics: Lyrics | null;
}

const parseSongRow = (row: StoredSongRow): StoredSong | null => {
  try {
    return {
      songKey: row.song_key,
      song: JSON.parse(row.song_json) as Song,
      storedAt: row.stored_at,
      lyricsState: row.lyrics_state,
      lyrics: row.lyrics_json ? (JSON.parse(row.lyrics_json) as Lyrics) : null,
    };
  } catch {
    return null; // Corrupt JSON: skip; verify-and-repair rewrites it.
  }
};

// ---------------------------------------------------------------------------
// dl_songs
// ---------------------------------------------------------------------------

/** Writes the song payload BEFORE any bytes land; preserves lyrics fields. */
export const upsertSong = (db: SQLiteDatabase, songKey: SongKey, song: Song): void => {
  db.runSync(
    `INSERT INTO dl_songs (song_key, song_json, stored_at)
     VALUES (?, ?, ?)
     ON CONFLICT(song_key) DO UPDATE SET
       song_json = excluded.song_json,
       stored_at = excluded.stored_at`,
    [songKey, JSON.stringify(song), Date.now()],
  );
};

export const getStoredSong = (db: SQLiteDatabase, songKey: SongKey): StoredSong | null => {
  const row = db.getFirstSync<StoredSongRow>(
    "SELECT * FROM dl_songs WHERE song_key = ?",
    [songKey],
  );
  return row ? parseSongRow(row) : null;
};

export const listStoredSongs = (db: SQLiteDatabase): StoredSong[] => {
  const rows = db.getAllSync<StoredSongRow>("SELECT * FROM dl_songs ORDER BY stored_at ASC");
  const out: StoredSong[] = [];
  for (const row of rows) {
    const parsed = parseSongRow(row);
    if (parsed) out.push(parsed);
  }
  return out;
};

export const deleteStoredSong = (db: SQLiteDatabase, songKey: SongKey): void => {
  db.runSync("DELETE FROM dl_songs WHERE song_key = ?", [songKey]);
};

/** FR-81 write half: tri-state lyrics stored with the download. */
export const setSongLyrics = (
  db: SQLiteDatabase,
  songKey: SongKey,
  state: LyricsState,
  lyrics: Lyrics | null,
): void => {
  db.runSync(
    "UPDATE dl_songs SET lyrics_state = ?, lyrics_json = ? WHERE song_key = ?",
    [state, lyrics ? JSON.stringify(lyrics) : null, songKey],
  );
};

// ---------------------------------------------------------------------------
// dl_files
// ---------------------------------------------------------------------------

export const getFile = (
  db: SQLiteDatabase,
  songKey: SongKey,
  kind: DownloadKind,
): DownloadEntry | null =>
  db.getFirstSync<DownloadEntry>(
    "SELECT * FROM dl_files WHERE song_key = ? AND kind = ?",
    [songKey, kind],
  );

export const listFilesForSong = (db: SQLiteDatabase, songKey: SongKey): DownloadEntry[] =>
  db.getAllSync<DownloadEntry>("SELECT * FROM dl_files WHERE song_key = ?", [songKey]);

export const listAllFiles = (db: SQLiteDatabase): DownloadEntry[] =>
  db.getAllSync<DownloadEntry>("SELECT * FROM dl_files");

export const listFilesByStatus = (
  db: SQLiteDatabase,
  status: DownloadFileStatus,
): DownloadEntry[] =>
  db.getAllSync<DownloadEntry>("SELECT * FROM dl_files WHERE status = ?", [status]);

/** Creates (or resets) a transfer row in `queued` state. */
export const upsertQueuedFile = (
  db: SQLiteDatabase,
  args: {
    songKey: SongKey;
    kind: DownloadKind;
    nodeId: FsNodeId;
    siblingNodeId: FsNodeId | null;
    filename: string;
  },
): void => {
  const now = Date.now();
  db.runSync(
    `INSERT INTO dl_files
       (song_key, kind, status, node_id, sibling_node_id, filename,
        local_uri, progress, size_bytes, savable, error, created_at, updated_at)
     VALUES (?, ?, 'queued', ?, ?, ?, NULL, 0, 0, NULL, NULL, ?, ?)
     ON CONFLICT(song_key, kind) DO UPDATE SET
       status = 'queued', node_id = excluded.node_id,
       sibling_node_id = excluded.sibling_node_id, filename = excluded.filename,
       local_uri = NULL, progress = 0, size_bytes = 0, savable = NULL,
       error = NULL, updated_at = excluded.updated_at`,
    [args.songKey, args.kind, args.nodeId, args.siblingNodeId, args.filename, now, now],
  );
};

export const setFileStatus = (
  db: SQLiteDatabase,
  songKey: SongKey,
  kind: DownloadKind,
  status: DownloadFileStatus,
  error: string | null = null,
): void => {
  db.runSync(
    "UPDATE dl_files SET status = ?, error = ?, updated_at = ? WHERE song_key = ? AND kind = ?",
    [status, error, Date.now(), songKey, kind],
  );
};

export const setFileProgress = (
  db: SQLiteDatabase,
  songKey: SongKey,
  kind: DownloadKind,
  progress: number,
): void => {
  db.runSync(
    `UPDATE dl_files SET status = 'downloading', progress = ?, updated_at = ?
     WHERE song_key = ? AND kind = ?`,
    [progress, Date.now(), songKey, kind],
  );
};

/** Savable persistence for boot re-attach (FR-84). Null clears it. */
export const setFileSavable = (
  db: SQLiteDatabase,
  songKey: SongKey,
  kind: DownloadKind,
  savable: string | null,
): void => {
  db.runSync(
    "UPDATE dl_files SET savable = ?, updated_at = ? WHERE song_key = ? AND kind = ?",
    [savable, Date.now(), songKey, kind],
  );
};

/** Completion: file stat lands in size_bytes, savable clears (FR-84/85). */
export const markFileDone = (
  db: SQLiteDatabase,
  songKey: SongKey,
  kind: DownloadKind,
  localUri: string,
  sizeBytes: number,
): void => {
  db.runSync(
    `UPDATE dl_files SET status = 'done', local_uri = ?, progress = 1,
       size_bytes = ?, savable = NULL, error = NULL, updated_at = ?
     WHERE song_key = ? AND kind = ?`,
    [localUri, sizeBytes, Date.now(), songKey, kind],
  );
};

export const deleteFile = (db: SQLiteDatabase, songKey: SongKey, kind: DownloadKind): void => {
  db.runSync("DELETE FROM dl_files WHERE song_key = ? AND kind = ?", [songKey, kind]);
};

/**
 * Freshness clock for the PLAY CACHE tier (orphan dl_files rows, no dl_songs
 * row): replaying a cached song bumps updated_at so the 7 day purge keeps
 * what the listener actually returns to.
 */
export const touchFile = (db: SQLiteDatabase, songKey: SongKey, kind: DownloadKind): void => {
  db.runSync(
    "UPDATE dl_files SET updated_at = ? WHERE song_key = ? AND kind = ?",
    [Date.now(), songKey, kind],
  );
};

export const deleteFilesForSong = (db: SQLiteDatabase, songKey: SongKey): void => {
  db.runSync("DELETE FROM dl_files WHERE song_key = ?", [songKey]);
};

/**
 * Byte accounting straight from the rows (freeze report 2026-08-14): the
 * overview used to WALK THE DISK - thousands of synchronous stat() calls on
 * the JS thread, re-attempted on every status bump. size_bytes is written at
 * completion, so two SUM queries answer the same question in microseconds.
 */
export const sumDoneFileBytes = (db: SQLiteDatabase): { bytes: number; files: number } => {
  const row = db.getFirstSync<{ files: number; bytes: number | null }>(
    "SELECT COUNT(*) AS files, SUM(size_bytes) AS bytes FROM dl_files WHERE status = 'done'",
  );
  return { bytes: row?.bytes ?? 0, files: row?.files ?? 0 };
};

/** The play-cache tier: done rows with no dl_songs row (orphan tier). */
export const sumCacheFileBytes = (db: SQLiteDatabase): { bytes: number; files: number } => {
  const row = db.getFirstSync<{ files: number; bytes: number | null }>(
    `SELECT COUNT(*) AS files, SUM(size_bytes) AS bytes FROM dl_files
      WHERE status = 'done'
        AND song_key NOT IN (SELECT song_key FROM dl_songs)`,
  );
  return { bytes: row?.bytes ?? 0, files: row?.files ?? 0 };
};

// ---------------------------------------------------------------------------
// offline_collections
// ---------------------------------------------------------------------------

export const listCollections = (db: SQLiteDatabase): string[] =>
  db
    .getAllSync<{ key: string }>("SELECT key FROM offline_collections ORDER BY added_at ASC")
    .map((row) => row.key);

export const addCollection = (db: SQLiteDatabase, key: string): void => {
  db.runSync(
    `INSERT INTO offline_collections (key, added_at) VALUES (?, ?)
     ON CONFLICT(key) DO NOTHING`,
    [key, Date.now()],
  );
};

export const removeCollection = (db: SQLiteDatabase, key: string): void => {
  db.runSync("DELETE FROM offline_collections WHERE key = ?", [key]);
};

// ---------------------------------------------------------------------------
// offline_playlists (schema v2)
//
// offline_collections knows only that playlist 42 is downloaded. Offline that
// is not enough to draw a row, so the name and artwork are cached here while
// the network is still up.
// ---------------------------------------------------------------------------

export interface OfflinePlaylistRow {
  id: number;
  name: string;
  artwork_fs_node_id: string | null;
  song_count: number;
  /** Preserves the liked-mirror detection (schema v3). */
  source_external_id: string | null;
}

export const listOfflinePlaylists = (db: SQLiteDatabase): OfflinePlaylistRow[] =>
  db.getAllSync<OfflinePlaylistRow>(
    `SELECT id, name, artwork_fs_node_id, song_count, source_external_id
       FROM offline_playlists
      ORDER BY name COLLATE NOCASE ASC`,
  );

export const upsertOfflinePlaylist = (db: SQLiteDatabase, row: OfflinePlaylistRow): void => {
  db.runSync(
    `INSERT INTO offline_playlists (id, name, artwork_fs_node_id, song_count, source_external_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       artwork_fs_node_id = excluded.artwork_fs_node_id,
       song_count = excluded.song_count,
       source_external_id = excluded.source_external_id,
       updated_at = excluded.updated_at`,
    [row.id, row.name, row.artwork_fs_node_id, row.song_count, row.source_external_id, Date.now()],
  );
};

export const deleteOfflinePlaylist = (db: SQLiteDatabase, id: number): void => {
  db.runSync("DELETE FROM offline_playlists WHERE id = ?", [id]);
};

// ---------------------------------------------------------------------------
// offline_collection_songs (schema v4)
//
// The persisted half of the session membership map: which songs an offline
// collection holds, in screen order, so a cold OFFLINE boot can rebuild the
// playlist screen from disk instead of erring on a network fetch.
// ---------------------------------------------------------------------------

/** Full replace: the screen's fresh song list IS the membership. */
export const replaceCollectionSongs = (
  db: SQLiteDatabase,
  collectionKey: string,
  songKeys: readonly SongKey[],
): void => {
  // First occurrence wins on duplicates (a playlist CAN hold the same song
  // twice; the PK cannot), and rows land in multi-row INSERTs instead of
  // one statement per song - a 300-song playlist was 300 sync INSERTs
  // inside a query-settle callback (freeze report 2026-08-14).
  const positions = new Map<SongKey, number>();
  songKeys.forEach((songKey, i) => {
    if (!positions.has(songKey)) positions.set(songKey, i);
  });
  const rows = [...positions.entries()];
  const CHUNK = 300;
  db.withTransactionSync(() => {
    db.runSync("DELETE FROM offline_collection_songs WHERE collection_key = ?", [collectionKey]);
    for (let start = 0; start < rows.length; start += CHUNK) {
      const chunk = rows.slice(start, start + CHUNK);
      const placeholders = chunk.map(() => "(?, ?, ?)").join(", ");
      const params: (string | number)[] = [];
      for (const [songKey, position] of chunk) params.push(collectionKey, songKey, position);
      db.runSync(
        `INSERT INTO offline_collection_songs (collection_key, song_key, position) VALUES ${placeholders}`,
        params,
      );
    }
  });
};

export const listCollectionSongKeys = (db: SQLiteDatabase, collectionKey: string): SongKey[] =>
  db
    .getAllSync<{ song_key: SongKey }>(
      `SELECT song_key FROM offline_collection_songs
        WHERE collection_key = ? ORDER BY position ASC`,
      [collectionKey],
    )
    .map((row) => row.song_key);

export const deleteCollectionSongs = (db: SQLiteDatabase, collectionKey: string): void => {
  db.runSync("DELETE FROM offline_collection_songs WHERE collection_key = ?", [collectionKey]);
};
