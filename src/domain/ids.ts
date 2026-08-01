/**
 * Branded id types. Song ids are numbers in REST payloads and strings on the
 * cable and in SQLite. This module is the ONLY legal conversion point between
 * the two representations (DESIGN.md section 4).
 */
export type SongId = number & { __brand: "SongId" };          // REST
export type SongKey = string & { __brand: "SongKey" };        // cable + sqlite
export type FsNodeId = string;
export type UserId = string;
export type SessionId = string;
export type PlaylistId = number;
export type ArtistId = number;
export type JamId = number;

export const toSongKey = (id: number): SongKey => String(id) as SongKey;
export const toSongId = (key: string): SongId => Number(key) as SongId;
