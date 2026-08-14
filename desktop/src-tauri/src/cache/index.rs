//! O indice SQLite. Deliberadamente ISOMORFICO ao esquema movel
//! (`src/db/schema.ts`): `songs`/`files` aqui sao `dl_songs`/`dl_files` la, com
//! os mesmos estados, os mesmos kinds e a mesma derivacao de "pinado"
//! (`song_key IN (SELECT song_key FROM songs)`). Nao ha segunda fonte de
//! verdade sobre o que e pinado, nas duas plataformas.
//!
//! Duas diferencas propositadas em relacao ao movel:
//!
//!  - `rel_path` e RELATIVO ao root (coluna `root`), nunca absoluto. Um
//!    caminho absoluto persistido morre com uma mudanca de identifier, de
//!    utilizador do sistema ou de versao do SO;
//!  - nao ha coluna `last_access_at`. O `updated_at` faz esse papel e o
//!    protocolo adia os toques 30 segundos, senao uma faixa de cinco minutos
//!    escrevia dezenas de UPDATEs.
//!
//! Nunca `tauri-plugin-sql`: poe a base no `app_config_dir` (que diverge do
//! `app_data_dir` em Linux), nao poe pragma nenhuma - sem WAL, sem
//! `busy_timeout`, sem `foreign_keys` - e abre uma thread do SO por ligacao do
//! pool.

use rusqlite::{params, Connection, OptionalExtension};
use rusqlite_migration::{Migrations, M};
use std::path::Path;

use super::paths::Root;
use super::{now_ms, FileKey, FileStatus, Kind};

/// Esquema v1. Muda-se acrescentando uma entrada nova a MIGRATIONS, nunca
/// editando esta - a mesma disciplina do MIGRATIONS do lado movel.
const SCHEMA_V1: &str = r#"
CREATE TABLE songs (
  song_key     TEXT PRIMARY KEY,
  song_json    TEXT NOT NULL,
  stored_at    INTEGER NOT NULL,
  lyrics_state TEXT NOT NULL DEFAULT 'unfetched'
               CHECK (lyrics_state IN ('unfetched','none','cached')),
  lyrics_json  TEXT
);

CREATE TABLE files (
  song_key     TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN
               ('mixed','mixed_original','artwork','vocal','instrumental')),
  status       TEXT NOT NULL CHECK (status IN ('queued','downloading','done','error')),
  media_id     TEXT NOT NULL,
  root         INTEGER NOT NULL,
  rel_path     TEXT NOT NULL,
  content_type TEXT,
  etag         TEXT,
  bytes        INTEGER NOT NULL DEFAULT 0,
  progress     REAL NOT NULL DEFAULT 0,
  predicted    INTEGER NOT NULL DEFAULT 0,
  error        TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (song_key, kind)
);
CREATE INDEX idx_files_status ON files(status);
CREATE INDEX idx_files_media  ON files(media_id)              WHERE status = 'done';
CREATE INDEX idx_files_evict  ON files(predicted, updated_at) WHERE status = 'done';

CREATE TABLE collections      (key TEXT PRIMARY KEY, added_at INTEGER NOT NULL);
CREATE TABLE collection_songs (collection_key TEXT NOT NULL, song_key TEXT NOT NULL,
                               position INTEGER NOT NULL,
                               PRIMARY KEY (collection_key, song_key));
CREATE TABLE offline_playlists (id INTEGER PRIMARY KEY, name TEXT NOT NULL,
                               artwork_media_id TEXT, song_count INTEGER NOT NULL DEFAULT 0,
                               source_external_id TEXT, updated_at INTEGER NOT NULL);

-- Chave/valor do proprio indice (tecto de bytes escolhido nas definicoes, e
-- o que mais vier). Nao esta no desenho original; existe porque o
-- cache_set_budget tem de sobreviver ao fecho da app e um JSON a parte era
-- um segundo ficheiro para manter coerente com este.
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
"#;

fn migrations() -> Migrations<'static> {
    Migrations::new(vec![M::up(SCHEMA_V1)])
}

/// Abre (ou cria) o indice com as pragmas certas. As pragmas sao aplicadas
/// SEMPRE, a cada abertura: `journal_mode` e persistente mas as outras nao, e
/// depender de uma abertura anterior ter corrido bem e como nao as ter.
pub fn open(path: &Path) -> Result<Connection, String> {
    let mut conn = Connection::open(path).map_err(|e| format!("indice: {e}"))?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| format!("pragma journal_mode: {e}"))?;
    conn.pragma_update(None, "synchronous", "NORMAL")
        .map_err(|e| format!("pragma synchronous: {e}"))?;
    conn.pragma_update(None, "busy_timeout", 5000)
        .map_err(|e| format!("pragma busy_timeout: {e}"))?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|e| format!("pragma foreign_keys: {e}"))?;
    migrations()
        .to_latest(&mut conn)
        .map_err(|e| format!("migracoes: {e}"))?;
    Ok(conn)
}

// ---------------------------------------------------------------------------
// files
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct FileRow {
    pub song_key: String,
    pub kind: Kind,
    pub status: FileStatus,
    pub media_id: String,
    pub root: Root,
    pub rel_path: String,
    pub content_type: Option<String>,
    pub etag: Option<String>,
    pub bytes: i64,
    pub progress: f64,
    pub predicted: bool,
    pub updated_at: i64,
}

impl FileRow {
    pub fn key(&self) -> FileKey {
        FileKey::new(self.song_key.clone(), self.kind)
    }
}

const FILE_COLUMNS: &str = "song_key, kind, status, media_id, root, rel_path, \
                            content_type, etag, bytes, progress, predicted, updated_at";

fn map_file(row: &rusqlite::Row<'_>) -> rusqlite::Result<Option<FileRow>> {
    let kind: String = row.get(1)?;
    let status: String = row.get(2)?;
    // Um kind/status que o CHECK deixou passar mas que este binario nao
    // conhece so pode vir de uma versao futura do esquema. Ignorar a linha e
    // a resposta honesta; explodir nao ajuda ninguem.
    let (Some(kind), Some(status)) = (Kind::parse(&kind), FileStatus::parse(&status)) else {
        return Ok(None);
    };
    Ok(Some(FileRow {
        song_key: row.get(0)?,
        kind,
        status,
        media_id: row.get(3)?,
        root: Root::from_i64(row.get(4)?),
        rel_path: row.get(5)?,
        content_type: row.get(6)?,
        etag: row.get(7)?,
        bytes: row.get(8)?,
        progress: row.get(9)?,
        predicted: row.get::<_, i64>(10)? != 0,
        updated_at: row.get(11)?,
    }))
}

fn query_files(conn: &Connection, sql: &str, args: &[&dyn rusqlite::ToSql]) -> Vec<FileRow> {
    let Ok(mut stmt) = conn.prepare(sql) else {
        return Vec::new();
    };
    let Ok(rows) = stmt.query_map(args, map_file) else {
        return Vec::new();
    };
    rows.flatten().flatten().collect()
}

pub fn get_file(conn: &Connection, key: &FileKey) -> Option<FileRow> {
    conn.query_row(
        &format!("SELECT {FILE_COLUMNS} FROM files WHERE song_key = ?1 AND kind = ?2"),
        params![key.song_key, key.kind.as_str()],
        map_file,
    )
    .optional()
    .ok()
    .flatten()
    .flatten()
}

/// Como o `/m/<mediaId>` e respondido: a linha `done` mais recente com aquele
/// media id. Serve os mosaicos que so conhecem a artwork e nao a musica.
pub fn resolve_media(conn: &Connection, media_id: &str) -> Option<FileRow> {
    conn.query_row(
        &format!(
            "SELECT {FILE_COLUMNS} FROM files \
             WHERE media_id = ?1 AND status = 'done' \
             ORDER BY updated_at DESC LIMIT 1"
        ),
        params![media_id],
        map_file,
    )
    .optional()
    .ok()
    .flatten()
    .flatten()
}

pub fn list_files(conn: &Connection) -> Vec<FileRow> {
    query_files(conn, &format!("SELECT {FILE_COLUMNS} FROM files"), &[])
}

pub fn list_done_files(conn: &Connection) -> Vec<FileRow> {
    query_files(
        conn,
        &format!("SELECT {FILE_COLUMNS} FROM files WHERE status = 'done'"),
        &[],
    )
}

/// Linhas por acabar de musicas PINADAS: sao estas que o arranque volta a
/// meter na fila, para "matar a app a meio de um download" retomar em vez de
/// recomecar.
pub fn list_resumable(conn: &Connection) -> Vec<FileRow> {
    query_files(
        conn,
        &format!(
            "SELECT {FILE_COLUMNS} FROM files \
             WHERE status IN ('queued','downloading') \
               AND song_key IN (SELECT song_key FROM songs)"
        ),
        &[],
    )
}

/// Cria (ou repoe) uma linha em `queued`. `predicted` fica em 0 por omissao,
/// para todos os caminhos explicitos manterem o comportamento de sempre.
pub fn upsert_queued(
    conn: &Connection,
    key: &FileKey,
    media_id: &str,
    root: Root,
    predicted: bool,
) -> Result<(), String> {
    let now = now_ms();
    conn.execute(
        "INSERT INTO files
           (song_key, kind, status, media_id, root, rel_path, content_type, etag,
            bytes, progress, predicted, error, created_at, updated_at)
         VALUES (?1, ?2, 'queued', ?3, ?4, '', NULL, NULL, 0, 0, ?5, NULL, ?6, ?6)
         ON CONFLICT(song_key, kind) DO UPDATE SET
           status = 'queued', media_id = excluded.media_id, root = excluded.root,
           rel_path = '', content_type = NULL, etag = NULL, bytes = 0, progress = 0,
           predicted = excluded.predicted, error = NULL, updated_at = excluded.updated_at",
        params![
            key.song_key,
            key.kind.as_str(),
            media_id,
            root.as_i64(),
            i64::from(predicted),
            now
        ],
    )
    .map(|_| ())
    .map_err(|e| format!("upsert_queued: {e}"))
}

pub fn set_status(
    conn: &Connection,
    key: &FileKey,
    status: FileStatus,
    error: Option<&str>,
) -> Result<(), String> {
    conn.execute(
        "UPDATE files SET status = ?1, error = ?2, updated_at = ?3
         WHERE song_key = ?4 AND kind = ?5",
        params![
            status.as_str(),
            error,
            now_ms(),
            key.song_key,
            key.kind.as_str()
        ],
    )
    .map(|_| ())
    .map_err(|e| format!("set_status: {e}"))
}

pub fn set_progress(conn: &Connection, key: &FileKey, progress: f64, bytes: i64) {
    let _ = conn.execute(
        "UPDATE files SET progress = ?1, bytes = ?2 WHERE song_key = ?3 AND kind = ?4",
        params![progress, bytes, key.song_key, key.kind.as_str()],
    );
}

/// So AQUI a linha passa a `done`, e so depois de o `rename` do `.part` ter
/// acontecido. A ordem importa: uma linha `done` a apontar para um ficheiro
/// que ainda nao existe e um 404 permanente para o player.
#[allow(clippy::too_many_arguments)]
pub fn mark_done(
    conn: &Connection,
    key: &FileKey,
    root: Root,
    rel_path: &str,
    content_type: Option<&str>,
    etag: Option<&str>,
    bytes: i64,
) -> Result<(), String> {
    conn.execute(
        "UPDATE files SET status = 'done', root = ?1, rel_path = ?2, content_type = ?3,
                          etag = ?4, bytes = ?5, progress = 1.0, error = NULL, updated_at = ?6
         WHERE song_key = ?7 AND kind = ?8",
        params![
            root.as_i64(),
            rel_path,
            content_type,
            etag,
            bytes,
            now_ms(),
            key.song_key,
            key.kind.as_str()
        ],
    )
    .map(|_| ())
    .map_err(|e| format!("mark_done: {e}"))
}

pub fn delete_file(conn: &Connection, key: &FileKey) {
    let _ = conn.execute(
        "DELETE FROM files WHERE song_key = ?1 AND kind = ?2",
        params![key.song_key, key.kind.as_str()],
    );
}

pub fn touch_file(conn: &Connection, key: &FileKey, at: i64) -> Result<(), String> {
    conn.execute(
        "UPDATE files SET updated_at = ?1 WHERE song_key = ?2 AND kind = ?3",
        params![at, key.song_key, key.kind.as_str()],
    )
    .map(|_| ())
    .map_err(|e| format!("touch_file: {e}"))
}

/// A promocao. Uma linha `predicted = 1` que o utilizador tocou mesmo deixa de
/// ser probatoria e passa a competir em pe de igualdade com o resto do cache.
/// Este UPDATE unico e a historia inteira do controlo de admissao.
pub fn touch_and_promote(conn: &Connection, song_key: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE files SET updated_at = ?1, predicted = 0 WHERE song_key = ?2",
        params![now_ms(), song_key],
    )
    .map(|_| ())
    .map_err(|e| format!("touch_and_promote: {e}"))
}

/// Candidatos a despejo, pior primeiro. Despejavel = sem linha em `songs`.
/// `predicted DESC` poe o probatorio a frente; dentro do mesmo tier e LRU puro
/// sobre `updated_at`.
pub fn list_evictable(conn: &Connection) -> Vec<FileRow> {
    query_files(
        conn,
        &format!(
            "SELECT {FILE_COLUMNS} FROM files \
             WHERE status = 'done' AND song_key NOT IN (SELECT song_key FROM songs) \
             ORDER BY predicted DESC, updated_at ASC"
        ),
        &[],
    )
}

/// As chaves das musicas PINADAS. Pinado e derivado (existe linha em `songs`),
/// nunca guardado duas vezes, por isso esta e a unica forma de o perguntar.
pub fn pinned_song_keys(conn: &Connection) -> std::collections::HashSet<String> {
    let Ok(mut stmt) = conn.prepare("SELECT song_key FROM songs") else {
        return std::collections::HashSet::new();
    };
    let Ok(rows) = stmt.query_map([], |row| row.get::<_, String>(0)) else {
        return std::collections::HashSet::new();
    };
    rows.flatten().collect()
}

/// Bytes ja escritos por transferencias DESPEJAVEIS que ainda nao acabaram -
/// isto e, o que os `.part` orfaos ocupam em disco.
///
/// Sem isto o tecto mentia: `list_evictable`, `list_expired` e `usage` filtram
/// todos por `status = 'done'`, portanto os parciais nao contavam para lado
/// nenhum e ocupavam disco fora da contabilidade toda.
pub fn evictable_partial_bytes(conn: &Connection) -> i64 {
    conn.query_row(
        "SELECT COALESCE(SUM(bytes),0) FROM files
         WHERE status <> 'done' AND song_key NOT IN (SELECT song_key FROM songs)",
        [],
        |row| row.get(0),
    )
    .unwrap_or(0)
}

/// Orfaos expirados (TTL). Mesmos 7 dias do `purgeStaleCache` movel.
pub fn list_expired(conn: &Connection, cutoff: i64) -> Vec<FileRow> {
    query_files(
        conn,
        &format!(
            "SELECT {FILE_COLUMNS} FROM files \
             WHERE status = 'done' AND updated_at < ?1 \
               AND song_key NOT IN (SELECT song_key FROM songs)"
        ),
        &[&cutoff],
    )
}

#[derive(Debug, Clone, Copy, Default, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CacheUsage {
    pub pinned_bytes: i64,
    pub pinned_files: i64,
    pub evictable_bytes: i64,
    pub evictable_files: i64,
}

/// Contabilidade por SUM em SQL, nunca por caminhada no disco: uma caminhada
/// sincrona num caminho quente e exactamente o que o relatorio de 2026-08-14
/// proibiu.
pub fn usage(conn: &Connection) -> CacheUsage {
    let read = |pinned: bool| -> (i64, i64) {
        let sql = if pinned {
            "SELECT COALESCE(SUM(bytes),0), COUNT(*) FROM files
             WHERE status = 'done' AND song_key IN (SELECT song_key FROM songs)"
        } else {
            "SELECT COALESCE(SUM(bytes),0), COUNT(*) FROM files
             WHERE status = 'done' AND song_key NOT IN (SELECT song_key FROM songs)"
        };
        conn.query_row(sql, [], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap_or((0, 0))
    };
    let (pinned_bytes, pinned_files) = read(true);
    let (evictable_bytes, evictable_files) = read(false);
    CacheUsage {
        pinned_bytes,
        pinned_files,
        evictable_bytes,
        evictable_files,
    }
}

// ---------------------------------------------------------------------------
// songs
// ---------------------------------------------------------------------------

pub fn upsert_song(conn: &Connection, song_key: &str, song_json: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO songs (song_key, song_json, stored_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(song_key) DO UPDATE SET
           song_json = excluded.song_json, stored_at = excluded.stored_at",
        params![song_key, song_json, now_ms()],
    )
    .map(|_| ())
    .map_err(|e| format!("upsert_song: {e}"))
}

pub fn delete_song(conn: &Connection, song_key: &str) {
    let _ = conn.execute("DELETE FROM songs WHERE song_key = ?1", params![song_key]);
}

pub fn list_song_json(conn: &Connection) -> Vec<String> {
    let Ok(mut stmt) = conn.prepare("SELECT song_json FROM songs ORDER BY stored_at ASC") else {
        return Vec::new();
    };
    let Ok(rows) = stmt.query_map([], |row| row.get::<_, String>(0)) else {
        return Vec::new();
    };
    rows.flatten().collect()
}

pub fn get_song_json(conn: &Connection, song_key: &str) -> Option<String> {
    conn.query_row(
        "SELECT song_json FROM songs WHERE song_key = ?1",
        params![song_key],
        |row| row.get::<_, String>(0),
    )
    .optional()
    .ok()
    .flatten()
}

/// Tri-estado das letras (nunca pedidas / confirmado que nao ha / em cache),
/// igual ao movel: sem ele, uma musica sem letra era pedida outra vez a cada
/// abertura.
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct StoredLyrics {
    pub state: String,
    pub json: Option<String>,
}

pub fn get_lyrics(conn: &Connection, song_key: &str) -> Option<StoredLyrics> {
    conn.query_row(
        "SELECT lyrics_state, lyrics_json FROM songs WHERE song_key = ?1",
        params![song_key],
        |row| {
            Ok(StoredLyrics {
                state: row.get(0)?,
                json: row.get(1)?,
            })
        },
    )
    .optional()
    .ok()
    .flatten()
}

pub fn set_lyrics(
    conn: &Connection,
    song_key: &str,
    state: &str,
    json: Option<&str>,
) -> Result<(), String> {
    if !matches!(state, "unfetched" | "none" | "cached") {
        return Err(format!("estado de letra invalido: {state}"));
    }
    conn.execute(
        "UPDATE songs SET lyrics_state = ?1, lyrics_json = ?2 WHERE song_key = ?3",
        params![state, json, song_key],
    )
    .map(|_| ())
    .map_err(|e| format!("set_lyrics: {e}"))
}

// ---------------------------------------------------------------------------
// collections / offline_playlists
// ---------------------------------------------------------------------------

pub fn add_collection(conn: &Connection, key: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO collections (key, added_at) VALUES (?1, ?2)
         ON CONFLICT(key) DO NOTHING",
        params![key, now_ms()],
    )
    .map(|_| ())
    .map_err(|e| format!("add_collection: {e}"))
}

pub fn remove_collection(conn: &Connection, key: &str) {
    let _ = conn.execute("DELETE FROM collections WHERE key = ?1", params![key]);
    let _ = conn.execute(
        "DELETE FROM collection_songs WHERE collection_key = ?1",
        params![key],
    );
}

pub fn list_collections(conn: &Connection) -> Vec<String> {
    let Ok(mut stmt) = conn.prepare("SELECT key FROM collections ORDER BY added_at ASC") else {
        return Vec::new();
    };
    let Ok(rows) = stmt.query_map([], |row| row.get::<_, String>(0)) else {
        return Vec::new();
    };
    rows.flatten().collect()
}

pub fn set_collection_songs(
    conn: &mut Connection,
    key: &str,
    song_keys: &[String],
) -> Result<(), String> {
    let tx = conn
        .transaction()
        .map_err(|e| format!("set_collection_songs: {e}"))?;
    tx.execute(
        "DELETE FROM collection_songs WHERE collection_key = ?1",
        params![key],
    )
    .map_err(|e| format!("set_collection_songs: {e}"))?;
    for (position, song_key) in song_keys.iter().enumerate() {
        tx.execute(
            "INSERT INTO collection_songs (collection_key, song_key, position)
             VALUES (?1, ?2, ?3) ON CONFLICT(collection_key, song_key) DO UPDATE SET
               position = excluded.position",
            params![key, song_key, position as i64],
        )
        .map_err(|e| format!("set_collection_songs: {e}"))?;
    }
    tx.commit().map_err(|e| format!("set_collection_songs: {e}"))
}

pub fn list_collection_songs(conn: &Connection, key: &str) -> Vec<String> {
    let Ok(mut stmt) = conn.prepare(
        "SELECT song_key FROM collection_songs WHERE collection_key = ?1 ORDER BY position ASC",
    ) else {
        return Vec::new();
    };
    let Ok(rows) = stmt.query_map(params![key], |row| row.get::<_, String>(0)) else {
        return Vec::new();
    };
    rows.flatten().collect()
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct OfflinePlaylist {
    pub id: i64,
    pub name: String,
    pub artwork_media_id: Option<String>,
    pub song_count: i64,
    pub source_external_id: Option<String>,
    pub updated_at: i64,
}

pub fn upsert_offline_playlist(
    conn: &Connection,
    playlist: &OfflinePlaylist,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO offline_playlists
           (id, name, artwork_media_id, song_count, source_external_id, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, artwork_media_id = excluded.artwork_media_id,
           song_count = excluded.song_count,
           source_external_id = excluded.source_external_id,
           updated_at = excluded.updated_at",
        params![
            playlist.id,
            playlist.name,
            playlist.artwork_media_id,
            playlist.song_count,
            playlist.source_external_id,
            now_ms()
        ],
    )
    .map(|_| ())
    .map_err(|e| format!("upsert_offline_playlist: {e}"))
}

pub fn delete_offline_playlist(conn: &Connection, id: i64) {
    let _ = conn.execute("DELETE FROM offline_playlists WHERE id = ?1", params![id]);
}

pub fn list_offline_playlists(conn: &Connection) -> Vec<OfflinePlaylist> {
    let Ok(mut stmt) = conn.prepare(
        "SELECT id, name, artwork_media_id, song_count, source_external_id, updated_at
         FROM offline_playlists ORDER BY updated_at DESC",
    ) else {
        return Vec::new();
    };
    let Ok(rows) = stmt.query_map([], |row| {
        Ok(OfflinePlaylist {
            id: row.get(0)?,
            name: row.get(1)?,
            artwork_media_id: row.get(2)?,
            song_count: row.get(3)?,
            source_external_id: row.get(4)?,
            updated_at: row.get(5)?,
        })
    }) else {
        return Vec::new();
    };
    rows.flatten().collect()
}

// ---------------------------------------------------------------------------
// meta
// ---------------------------------------------------------------------------

pub fn meta_get(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM meta WHERE key = ?1", params![key], |row| {
        row.get::<_, Option<String>>(0)
    })
    .optional()
    .ok()
    .flatten()
    .flatten()
}

pub fn meta_set(conn: &Connection, key: &str, value: &str) {
    let _ = conn.execute(
        "INSERT INTO meta (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn memory() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        migrations().to_latest(&mut conn).unwrap();
        conn
    }

    fn insert_done(conn: &Connection, song_key: &str, predicted: bool, updated_at: i64, bytes: i64) {
        conn.execute(
            "INSERT INTO files (song_key, kind, status, media_id, root, rel_path, bytes,
                                progress, predicted, created_at, updated_at)
             VALUES (?1, 'mixed', 'done', '1', 0, ?2, ?3, 1.0, ?4, 0, ?5)",
            params![
                song_key,
                format!("{song_key}_mixed.m4a"),
                bytes,
                i64::from(predicted),
                updated_at
            ],
        )
        .unwrap();
    }

    #[test]
    fn evictable_excludes_pinned_and_orders_predicted_first() {
        let conn = memory();
        upsert_song(&conn, "1", "{}").unwrap();
        insert_done(&conn, "1", false, 10, 100); // pinado
        insert_done(&conn, "2", false, 20, 100); // tocado, mais recente
        insert_done(&conn, "3", false, 5, 100); // tocado, mais antigo
        insert_done(&conn, "4", true, 999, 100); // probatorio, fresquissimo

        let rows = list_evictable(&conn);
        let keys: Vec<&str> = rows.iter().map(|r| r.song_key.as_str()).collect();
        // O probatorio vai a frente mesmo sendo o mais recente de todos; a
        // musica pinada nem aparece.
        assert_eq!(keys, vec!["4", "3", "2"]);
    }

    #[test]
    fn usage_splits_pinned_from_evictable() {
        let conn = memory();
        upsert_song(&conn, "1", "{}").unwrap();
        insert_done(&conn, "1", false, 10, 700);
        insert_done(&conn, "2", true, 20, 300);

        let usage = usage(&conn);
        assert_eq!(usage.pinned_bytes, 700);
        assert_eq!(usage.pinned_files, 1);
        assert_eq!(usage.evictable_bytes, 300);
        assert_eq!(usage.evictable_files, 1);
    }

    #[test]
    fn promotion_clears_the_probationary_flag() {
        let conn = memory();
        insert_done(&conn, "7", true, 1, 100);
        touch_and_promote(&conn, "7").unwrap();
        let row = get_file(&conn, &FileKey::new("7", Kind::Mixed)).unwrap();
        assert!(!row.predicted);
        assert!(row.updated_at > 1);
    }

    #[test]
    fn resolve_media_picks_the_newest_done_row() {
        let conn = memory();
        conn.execute(
            "INSERT INTO files (song_key, kind, status, media_id, root, rel_path, bytes,
                                progress, predicted, created_at, updated_at)
             VALUES ('1', 'artwork', 'done', '42', 1, '1_artwork.jpg', 10, 1.0, 0, 0, 100)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO files (song_key, kind, status, media_id, root, rel_path, bytes,
                                progress, predicted, created_at, updated_at)
             VALUES ('2', 'artwork', 'done', '42', 1, '2_artwork.jpg', 10, 1.0, 0, 0, 200)",
            [],
        )
        .unwrap();
        let row = resolve_media(&conn, "42").unwrap();
        assert_eq!(row.song_key, "2");
        // Um media id que nao existe nao devolve linha nenhuma - e assim que o
        // protocolo responde 404 em vez de servir bytes errados.
        assert!(resolve_media(&conn, "43").is_none());
    }
}
