/**
 * Lyrics REST (API.md section 10). 200-with-nulls means "no lyrics" (NOT a
 * 404); first fetch can take seconds (inline external lookups). NEVER
 * auto-retry translation 429/404 (60/h cap); sync capped 10/h.
 */
import { request } from "../client";
import type { SongId } from "@/domain/ids";
import type { Lyrics, LyricsTranslation, LyricsTranslationTarget } from "@/domain/lyrics";

export const getLyrics = (songId: SongId): Promise<Lyrics> =>
  request("GET", "/lyrics", { params: { song_id: songId }, timeoutMs: 60_000 });

export const getLyricsTranslation = (
  songId: SongId,
  target: LyricsTranslationTarget,
): Promise<LyricsTranslation> =>
  request("GET", "/lyrics/translation", {
    params: { song_id: songId, target },
    timeoutMs: 60_000,
  });

/** 201 { job_id }; await via JobChannel + 10s REST poll fallback. */
export const startLyricsSync = (songId: SongId): Promise<{ job_id: string }> =>
  request("POST", "/lyrics/sync", { body: { song_id: songId } });
