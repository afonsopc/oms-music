/**
 * Branded id types. Song ids are numbers in REST payloads and strings on the
 * cable and in SQLite. This module is the ONLY legal conversion point between
 * the two representations (DESIGN.md section 4).
 */
export type SongId = number & { __brand: "SongId" };          // REST
export type SongKey = string & { __brand: "SongKey" };        // cable + sqlite
/**
 * A media id is the backend's ActiveStorage attachment id serialized as a
 * decimal string (the fs_nodes -> ActiveStorage migration, 2026-08). Used
 * verbatim in `/media/:id/...` URLs and stored as TEXT in SQLite.
 */
export type MediaId = string;
/** @deprecated Legacy alias from the fs_nodes era; new code uses MediaId. */
export type FsNodeId = MediaId;
export type UserId = string;
export type SessionId = string;
export type PlaylistId = number;
export type ArtistId = number;
export type JamId = number;

export const toSongKey = (id: number): SongKey => String(id) as SongKey;
export const toSongId = (key: string): SongId => Number(key) as SongId;
