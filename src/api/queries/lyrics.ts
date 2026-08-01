/**
 * Lyrics hooks (FR-75, FR-79 data). ~24h client cache on the base fetch (the
 * server negative-caches misses 24h - no aggressive retry). Translation:
 * staleTime Infinity, NEVER auto-retry (429/404 must not refetch).
 */
import { useQuery } from "@tanstack/react-query";
import { getLyrics, getLyricsTranslation } from "../endpoints/lyrics";
import { keys } from "../queryKeys";
import { guardedQueryFn } from "./common";
import { useAuthReady } from "@/auth/guard";
import { withOfflineFallback } from "@/contracts/offlineFallback";
import type { SongId } from "@/domain/ids";
import type { LyricsTranslationTarget } from "@/domain/lyrics";

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
