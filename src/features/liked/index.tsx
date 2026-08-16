/**
 * Liked songs (FR-45). Cursor-paged (`before=<liked_at>`, never an offset)
 * so liking something mid-scroll cannot shift the pages under the user.
 * Purple hero with the shared LikedArtwork tile and the `#7e22ce` accent,
 * owner row (the session user - liked songs are always yours), play/shuffle
 * on the right of the action bar, and `addedAt = liked_at` in the table.
 *
 * Renders through the shared CollectionScreen (ponto 16, vistas a Spotify):
 * before this it duplicated the Hero + StickyTitle + SongTable assembly by
 * hand, and every header redesign had to be made twice. The hover-heart on
 * this surface is an inline "remove from liked" like everywhere else.
 */
import React, { useMemo } from "react";
import { useLikedIds, useLikedInfinite } from "@/api/queries/likedSongs";
import { avatarUrl } from "@/api/mediaUrl";
import { useSessionStore } from "@/auth/session";
import { splitDuration, totalDuration } from "@/domain/format";
import type { Song } from "@/domain/song";
import { useT } from "@/i18n";
import { LIKED_ACCENT } from "@/theme/tokens";
import { LikedArtwork } from "@/ui";
import { CollectionScreen } from "@/features/playlist/CollectionScreen";

export default function LikedScreen() {
  const t = useT();
  const sessionUser = useSessionStore((s) => s.user);

  const likedQuery = useLikedInfinite();
  const likedIdsQuery = useLikedIds();

  const rows = useMemo(() => likedQuery.data?.pages.flat() ?? [], [likedQuery.data]);
  const songs = useMemo<Song[]>(() => rows.map((row) => row.song), [rows]);
  const likedAt = useMemo(() => {
    const map = new Map<number, string>();
    for (const row of rows) map.set(row.song.id, row.liked_at);
    return map;
  }, [rows]);

  const title = t("components.music.LikedSongsView.title");

  // The list is cursor-paged, so `songs.length` only counts the LOADED
  // pages and undersold the collection until the user scrolled to the end.
  // `/liked_songs/ids` already ships the complete set for the hearts, so
  // its size IS the server total; the pages only fill in as a fallback,
  // announced as a floor while more of them remain. The total DURATION is
  // only computable from loaded rows, so it stays quiet until the last
  // page lands - the same honesty rule the playlist hero follows.
  const totalLiked = likedIdsQuery.data?.length ?? null;
  const heroMeta = useMemo(() => {
    const parts: string[] = [];
    if (totalLiked === null && likedQuery.hasNextPage) {
      parts.push(t("native.desktop.moreThanSongs", { count: songs.length }));
    } else {
      parts.push(`${totalLiked ?? songs.length} ${t("components.music.LikedSongsView.songs")}`);
    }
    if (!likedQuery.hasNextPage && songs.length > 0) {
      const { hours, minutes } = splitDuration(totalDuration(songs));
      parts.push(hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`);
    }
    return parts.join(" • ");
  }, [totalLiked, likedQuery.hasNextPage, songs, t]);

  return (
    <CollectionScreen
      kind="playlist"
      title={title}
      subtitle={t("components.music.LikedSongsView.subtitle")}
      meta={heroMeta}
      owner={
        sessionUser
          ? { name: sessionUser.name, avatarUri: avatarUrl(sessionUser.id) }
          : undefined
      }
      artworkSlot={(size) => <LikedArtwork size={size} />}
      accentColor={LIKED_ACCENT}
      songs={songs}
      isLoading={likedQuery.isLoading}
      isError={likedQuery.isError}
      errorText={t("components.music.LikedSongsView.errorLoading")}
      emptyText={t("components.music.LikedSongsView.empty")}
      emptyIcon="heart"
      onRetry={() => void likedQuery.refetch()}
      addedAtFor={(song) => likedAt.get(song.id)}
      surface="liked"
      recentEntry={{ kind: "liked", key: "liked", title, artworkNodeId: null, heart: true }}
      hasMore={likedQuery.hasNextPage}
      isLoadingMore={likedQuery.isFetchingNextPage}
      onLoadMore={() => void likedQuery.fetchNextPage()}
    />
  );
}
