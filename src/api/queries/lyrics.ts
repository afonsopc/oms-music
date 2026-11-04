/**
 * Lyrics hooks (FR-75, FR-79 data). ~24h client cache on the base fetch (the
 * server negative-caches misses 24h - no aggressive retry). Translation:
 * staleTime Infinity, NEVER auto-retry (429/404 must not refetch; the SDK
 * already passes retry:false on that call). 200-with-nulls means "no lyrics".
 *
 * `getLyrics(songId)` is the offline-fallback boundary (and the downloads
 * manager's lyrics prefetch); `startLyricsSync` feeds lyrics/syncJob.ts.
 */
import { useQuery } from "@tanstack/react-query";
import { oms } from "../oms";
import { keys } from "../queryKeys";
import { guardedQueryFn } from "./common";
import { useAuthReady } from "@/auth/guard";
import { withOfflineFallback } from "@/contracts/offlineFallback";
import type { SongId } from "@/domain/ids";
import type { Lyrics, LyricsTranslation, LyricsTranslationTarget } from "@/domain/lyrics";

export const getLyrics = (songId: SongId): Promise<Lyrics> => oms().music.songs.lyrics(songId);

export const getLyricsTranslation = (
  songId: SongId,
  target: LyricsTranslationTarget,
): Promise<LyricsTranslation> => oms().music.songs.lyricsTranslation(songId, target);

/** 201 { job_id }; await via JobChannel + 10s REST poll fallback (10/h cap). */
export const startLyricsSync = (songId: SongId): Promise<{ job_id: string }> =>
  oms().music.songs.syncLyrics(songId);

const getLyricsWithFallback = withOfflineFallback(getLyrics, "lyrics");

const DAY_MS = 24 * 60 * 60 * 1000;

export const useLyrics = (songId: SongId | null, enabled = true) => {
  const authReady = useAuthReady();
  const key = songId != null ? keys.lyrics(songId) : ["lyrics", "none"];
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, () => getLyricsWithFallback(songId as SongId)),
    enabled: authReady && enabled && songId != null,
    staleTime: DAY_MS,
    gcTime: DAY_MS,
  });
};

export const useLyricsTranslation = (
  songId: SongId | null,
  target: LyricsTranslationTarget,
  enabled = true,
) => {
  const authReady = useAuthReady();
  const key =
    songId != null ? keys.lyricsTranslation(songId, target) : ["lyrics", "translation", "none"];
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, () => getLyricsTranslation(songId as SongId, target)),
    enabled: authReady && enabled && songId != null,
    staleTime: Infinity,
    gcTime: DAY_MS,
    retry: false,
  });
};

// ----- 2026-11-04: pré-carregar, traduzir de novo, acertos do dono ----------

/** "Traduzir de novo": uma versão nova, que passa a ser a guardada (10/h). */
export const retranslateLyrics = (
  songId: SongId,
  target: LyricsTranslationTarget,
): Promise<LyricsTranslation> =>
  oms().http.get<LyricsTranslation>("/lyrics/translation", {
    timeoutMs: 60000,
    retry: false,
    query: { song_id: songId, target, again: 1 },
  });

/** O acerto do dono: a letra toda mais cedo (negativo) ou mais tarde. */
export const nudgeLyricsOffset = (songId: SongId, deltaMs: number): Promise<Lyrics> =>
  oms().http.patch<Lyrics>("/lyrics/offset", { song_id: songId, delta_ms: deltaMs }, { retry: false });

/** "Acertar pela voz": 201 { job_id }, como a sync (o dono, 10/h). */
export const refineLyrics = (songId: SongId): Promise<{ job_id: string }> =>
  oms().http.post<{ job_id: string }>("/lyrics/refine", { song_id: songId }, { retry: false });

/**
 * As próximas da fila: o servidor devolve já as letras que tem e vai buscar
 * as outras (e a tradução, com `target`) para quando a música começar.
 */
export const prefetchLyrics = (
  songIds: readonly SongId[],
  target: LyricsTranslationTarget | null,
): Promise<{ lyrics: Record<string, Lyrics>; pending: number[] }> =>
  oms().http.post("/lyrics/prefetch", { song_ids: songIds, target: target ?? undefined }, { retry: false });
