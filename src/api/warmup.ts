/**
 * Library warm-up (local-first, owner request 2026-08-10 "optimistic na app
 * toda"): a few seconds after sign-in the app quietly prefetches everything a
 * tap is likely to land on - the playlists WITH their first page of songs,
 * the liked ids, the library rosters, the recently played albums with their
 * tracks, the mixes - plus the artwork bitmaps for all of it. Combined with
 * the disk-persisted query cache (persistCache.ts) this makes both the
 * current session and the NEXT boot answer from local state, with the
 * network only revalidating behind the paint.
 *
 * Discipline:
 *  - every prefetch goes through queryClient.prefetchQuery with the SAME key
 *    its hook uses, so it lands exactly where the screens read;
 *  - staleTime applies: anything a mounted screen already fetched is skipped
 *    for free, and one warm sweep never repeats within its freshness window;
 *  - requests run SEQUENTIALLY with a gap - a warm-up must never compete
 *    with the live stream or the rate bucket (600/min authed);
 *  - one run per sign-in, kicked off after the boot screens settle;
 *  - failures are silent: a warm-up is an optimization, never an error.
 */
import { useSessionStore } from "@/auth/session";
import {
  prefetchArtwork,
  registerArtworkPrefetch,
  resetArtworkPrefetch,
  warmHomeArtwork,
} from "./artworkPrefetch";
import { listArtists } from "./endpoints/artists";
import { listLikedIds } from "./endpoints/likedSongs";
import { listMixes } from "./endpoints/mixes";
import { listRecentAlbums, type RecentlyPlayedAlbum } from "./endpoints/playEvents";
import { listPlaylists } from "./endpoints/playlists";
import { listPlaylistSongsPage } from "./endpoints/playlistSongs";
import { listAlbums, listAlbumSongs } from "./endpoints/songs";
import { pageModifier } from "./params";
import { keys } from "./queryKeys";
import { queryClient } from "./queryClient";
import type { Playlist } from "@/domain/playlist";

/** Let the mounted screens' own queries land first. */
const START_DELAY_MS = 2_500;
/** Pause between prefetches: a sweep, not a burst. */
const STEP_GAP_MS = 150;
/** Matches features/home RECENT_ALBUMS_LIMIT so the key lines up. */
const RECENT_ALBUMS_LIMIT = 12;
/** Matches features/library LIBRARY_ITEM_LIMIT. */
const LIBRARY_LIMIT = 500;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const warmLibrary = async (): Promise<void> => {
  const qc = queryClient;
  const steps: (() => Promise<unknown>)[] = [];

  // The backbone lists first: what the Library and Home read.
  steps.push(() =>
    qc.prefetchQuery({
      queryKey: keys.playlists.list({ page: "1:500" }),
      queryFn: () => listPlaylists({ modifiers: { page: pageModifier(1, 500) } }),
    }),
  );
  steps.push(() =>
    qc.prefetchQuery({ queryKey: keys.liked.ids, queryFn: () => listLikedIds() }),
  );
  steps.push(() =>
    qc.prefetchQuery({ queryKey: keys.mixes.list, queryFn: () => listMixes() }),
  );
  steps.push(() =>
    qc.prefetchQuery({
      queryKey: keys.playEvents.recentAlbums(RECENT_ALBUMS_LIMIT),
      queryFn: () => listRecentAlbums(RECENT_ALBUMS_LIMIT),
    }),
  );
  steps.push(() =>
    qc.prefetchQuery({
      queryKey: keys.albums.list({ page: LIBRARY_LIMIT }),
      queryFn: () => listAlbums({ modifiers: { page: pageModifier(1, LIBRARY_LIMIT) } }),
    }),
  );
  steps.push(() =>
    qc.prefetchQuery({
      queryKey: keys.artists.list({ page: LIBRARY_LIMIT, order: "name:asc" }),
      queryFn: () =>
        listArtists({ modifiers: { page: pageModifier(1, LIBRARY_LIMIT), order: "name:asc" } }),
    }),
  );

  for (const step of steps) {
    await step().catch(() => undefined);
    await sleep(STEP_GAP_MS);
  }

  // Depth second: the first page of every playlist, the tracks of the albums
  // you actually played - the places a tap lands next.
  const playlists = qc.getQueryData<Playlist[]>(keys.playlists.list({ page: "1:500" })) ?? [];
  const recents =
    qc.getQueryData<RecentlyPlayedAlbum[]>(keys.playEvents.recentAlbums(RECENT_ALBUMS_LIMIT)) ??
    [];

  // Bitmaps go through artworkPrefetch, which re-keys them under the MEDIA ID
  // that ArtworkImage reads. The plain `Image.prefetch(urls)` that used to sit
  // here filed everything under the URL and therefore produced zero cache hits
  // (see the header of api/artworkPrefetch.ts). `warmHomeArtwork` also folds
  // in the mixes rail and the local quick grid, which this sweep never saw.
  prefetchArtwork(playlists.map((p) => p.artwork_media_id));
  prefetchArtwork(recents.map((a) => a.artwork_media_id));
  warmHomeArtwork();

  for (const playlist of playlists) {
    await qc
      .prefetchInfiniteQuery({
        queryKey: keys.playlistSongs(playlist.id),
        queryFn: ({ pageParam }) => listPlaylistSongsPage(playlist.id, pageParam as number),
        initialPageParam: 1,
      })
      .catch(() => undefined);
    await sleep(STEP_GAP_MS);
  }

  for (const album of recents) {
    if (!album.album) continue;
    await qc
      .prefetchQuery({
        queryKey: keys.songs.byAlbum(album.album),
        queryFn: () => listAlbumSongs(album.album),
      })
      .catch(() => undefined);
    await sleep(STEP_GAP_MS);
  }
};

let warmedForUser: string | null = null;

/** Called by boot/wireup: one background sweep per sign-in. */
export const registerLibraryWarmup = (): void => {
  // The artwork half installs itself here rather than through its own wireup
  // entry: it has no provider, no slot and no React, and it is only ever
  // useful once there is a session to warm for.
  registerArtworkPrefetch();

  const maybeWarm = (): void => {
    const state = useSessionStore.getState();
    if (state.status !== "authed") return;
    const userId = state.user?.id ?? state.session?.user_id ?? "unknown";
    if (warmedForUser === userId) return;
    // A different user's covers have nothing to do with this one's, and the
    // attempted-set would otherwise suppress every warm on an account switch.
    if (warmedForUser !== null) resetArtworkPrefetch();
    warmedForUser = userId;
    setTimeout(() => {
      void warmLibrary().catch(() => undefined);
    }, START_DELAY_MS);
  };
  useSessionStore.subscribe(maybeWarm);
  maybeWarm();
};
