/**
 * FROZEN SQLite DDL (DESIGN.md 9.1). Database file: oms-music-<userId>.db.
 * Changes go through the WP1 owner as explicit change requests.
 */

export const SCHEMA_VERSION = 2;

/**
 * Migration 2: offline playlist metadata.
 *
 * `offline_collections` stores keys and nothing else, so with no network there
 * was no way to render a downloaded playlist's name or artwork: the library
 * simply looked empty, which is the opposite of what an offline mode is for.
 * Rows are written whenever a playlist screen loads online while that playlist
 * is an offline collection, and dropped when the collection is turned off.
 */
export const MIGRATION_OFFLINE_PLAYLISTS = `
CREATE TABLE IF NOT EXISTS offline_playlists (
  id                  INTEGER PRIMARY KEY,
  name                TEXT NOT NULL,
  artwork_fs_node_id  TEXT,
  song_count          INTEGER NOT NULL DEFAULT 0,
  updated_at          INTEGER NOT NULL
);
`;

export const DDL = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS dl_songs (
  song_key     TEXT PRIMARY KEY,
  song_json    TEXT NOT NULL,
  stored_at    INTEGER NOT NULL,
  lyrics_state TEXT NOT NULL DEFAULT 'unfetched'
               CHECK (lyrics_state IN ('unfetched','none','cached')),
  lyrics_json  TEXT
);

CREATE TABLE IF NOT EXISTS dl_files (
  song_key        TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN
                  ('mixed','mixed_original','artwork','vocal','instrumental')),
  status          TEXT NOT NULL CHECK (status IN ('queued','downloading','done','error')),
  node_id         TEXT NOT NULL,
  sibling_node_id TEXT,
  filename        TEXT NOT NULL,
  local_uri       TEXT,
  progress        REAL NOT NULL DEFAULT 0,
  size_bytes      INTEGER NOT NULL DEFAULT 0,
  savable         TEXT,
  error           TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  PRIMARY KEY (song_key, kind)
);
CREATE INDEX IF NOT EXISTS idx_dl_files_status ON dl_files (status);

CREATE TABLE IF NOT EXISTS offline_collections (
  key      TEXT PRIMARY KEY,
  added_at INTEGER NOT NULL
);
`;

/**
 * Ordered migrations. Index 0 applies when the stored schema_version is 0
 * (fresh db). Future migrations append; NEVER edit an applied entry.
 */
export const MIGRATIONS: readonly string[] = [DDL, MIGRATION_OFFLINE_PLAYLISTS];
