/** Play-event hooks: home top tiles + artist rails + popular lists. */
import { useQuery } from "@tanstack/react-query";
import {
  listRecentAlbums,
  listTopArtists,
  listTopSongs,
  type TopSince,
} from "../endpoints/playEvents";
import { keys } from "../queryKeys";
import { guardedQueryFn } from "./common";
import { useAuthReady } from "@/auth/guard";

/** Up to 8 recently played albums (FR-24); handle polymorphic `artist`. */
export const useRecentAlbums = (limit = 8, enabled = true) => {
  const authReady = useAuthReady();
  const key = keys.playEvents.recentAlbums(limit);
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, () => listRecentAlbums(limit)),
    enabled: authReady && enabled,
  });
};

/** "Your artists" rail: top artists of the last 30 days (FR-28). */
export const useTopArtists = (since: TopSince = "30d", limit = 10, enabled = true) => {
  const authReady = useAuthReady();
  const key = keys.playEvents.top("artist", since, null, limit);
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, () => listTopArtists(since, limit)),
    enabled: authReady && enabled,
  });
};

/** Top global do utilizador (Rewind): sem filtro de artista. */
export const useTopSongsOverall = (
  since: TopSince = "all",
  limit = 5,
  enabled = true,
) => {
  const authReady = useAuthReady();
  const key = keys.playEvents.top("song", since, null, limit);
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, () => listTopSongs({ since, limit })),
    enabled: authReady && enabled,
  });
};

/** Artist "Popular" top 5 by all-time plays (FR-39). */
export const useTopSongs = (
  artist: string | null,
  opts: { since?: TopSince; limit?: number; enabled?: boolean } = {},
) => {
  const authReady = useAuthReady();
  const key = keys.playEvents.top("song", opts.since ?? "all", artist, opts.limit ?? 5);
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, () =>
      listTopSongs({ artist: artist ?? undefined, since: opts.since, limit: opts.limit }),
    ),
    enabled: authReady && (opts.enabled ?? true) && !!artist,
  });
};
