/**
 * Music storage quota (fs_nodes -> ActiveStorage migration): the server-side
 * usage of the account's music media (songs, artwork, stems, playlist covers)
 * against the per-user limit. One authenticated GET; the settings overview is
 * the only consumer.
 */
import { request } from "../client";

export interface MusicStorage {
  used_bytes: number;
  limit_bytes: number;
}

export const getMusicStorage = (): Promise<MusicStorage> =>
  request("GET", "/music/storage");
