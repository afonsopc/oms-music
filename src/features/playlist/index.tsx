/**
 * Playlist detail (FR-48, FR-50, FR-52, FR-53). Three flavors:
 *  - manual: row removal + drag reorder (ONLY when fully loaded; sends the
 *    COMPLETE song-id array, optimistic with rollback) + delete;
 *  - system (Spotify-synced): read-only rows, "Synced from Spotify"
 *    subtitle + last-synced meta, Copy + Delete only - NO edit affordance
 *    ever (the server rejects all of them including rename);
 *  - liked mirror: the purple heart artwork + #7e22ce accent.
 *
 * FR-51 (artwork change) ships for manual playlists through
 * ChangePlaylistArtwork: the pick is center-cropped to a square and re-encoded
 * to JPEG under ~2 MB on the device before the multipart upload.
 */
import React, { useCallback, useMemo, useState } from "react";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import {
  useCopyPlaylist,
  useDeletePlaylist,
  usePlaylist,
  useReorderPlaylist,
} from "@/api/queries/playlists";
import { usePlaylistSongsInfinite, useRemovePlaylistSong } from "@/api/queries/playlistSongs";
import { useUser } from "@/api/queries/users";
import { keys } from "@/api/queryKeys";
import { avatarUrl } from "@/api/mediaUrl";
import { useSessionStore } from "@/auth/session";
import type { SongMenuItem } from "@/contracts/songMenu";
import { playlistArtworkSource } from "@/domain/artwork";
import { splitDuration, totalDuration } from "@/domain/format";
import { useOfflinePlaylistIdentity } from "@/downloads/collections";
import type { PlaylistId } from "@/domain/ids";
import { isLikedMirror, isSystemPlaylist, type PlaylistSong } from "@/domain/playlist";
import type { Song } from "@/domain/song";
import { useLocale, useT } from "@/i18n";
import { formatDate } from "@/lib/dates";
import { playlistRoute } from "@/lib/routes";
import { LIKED_ACCENT } from "@/theme/tokens";
import {
  artworkSourceUri,
  ConfirmDialog,
  ErrorState,
  LikedArtwork,
  type ActionBarMenuItem,
} from "@/ui";
import { ChangePlaylistArtwork } from "./ChangePlaylistArtwork";
import { CollectionScreen } from "./CollectionScreen";

const arrayMove = <T,>(items: readonly T[], from: number, to: number): T[] => {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
};

export default function PlaylistScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const playlistId = Number(params.id);
  if (!Number.isInteger(playlistId) || playlistId <= 0) {
    return <Redirect href="/playlists" />;
  }
  return <PlaylistBody playlistId={playlistId as PlaylistId} />;
}

const PlaylistBody = ({ playlistId }: { playlistId: PlaylistId }) => {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const qc = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Drag handles only on request (the ellipsis menu): always-on reorder made
  // every row wear a grip nobody was using.
  const [reorderMode, setReorderMode] = useState(false);

  const playlistQuery = usePlaylist(playlistId);
  const songsQuery = usePlaylistSongsInfinite(playlistId);
  const removeMutation = useRemovePlaylistSong();
  const reorderMutation = useReorderPlaylist();
  const deleteMutation = useDeletePlaylist();
  const copyMutation = useCopyPlaylist();

  const playlist = playlistQuery.data ?? null;
  const system = playlist ? isSystemPlaylist(playlist) : false;
  const likedMirror = playlist ? isLikedMirror(playlist) : false;

  /**
   * Linha do dono a Spotify (ponto 16): quase sempre e o proprio (a sessao
   * ja tem o User carregado), mas uma playlist partilhada por outra conta
   * resolve o dono por /users/:id - ate la a linha simplesmente nao aparece.
   */
  const sessionUser = useSessionStore((s) => s.user);
  const ownerIsSelf = playlist != null && sessionUser?.id === playlist.user_id;
  const ownerQuery = useUser(playlist?.user_id ?? null, playlist != null && !ownerIsSelf);
  const ownerUser = ownerIsSelf ? sessionUser : (ownerQuery.data ?? null);
  const owner = ownerUser
    ? { name: ownerUser.name, avatarUri: avatarUrl(ownerUser.id) }
    : undefined;

  const rows = useMemo(() => songsQuery.data?.pages.flat() ?? [], [songsQuery.data]);
  const songs = useMemo(() => rows.map((r) => r.song), [rows]);

  // Cache the identity while the network still answers, so a downloaded
  // playlist can be listed offline instead of vanishing from the library.
  useOfflinePlaylistIdentity(
    playlist?.id ?? null,
    playlist?.name ?? null,
    playlist?.artwork_media_id ?? null,
    songs.length,
    playlist?.source_external_id ?? null,
  );

  const meta = useMemo(() => {
    const parts: string[] = [];
    // The pages are infinite (100 a pop) and the playlist payload carries no
    // song_count, so before the last page lands the loaded slice UNDERSELLS
    // the playlist - the hero used to claim "100 músicas" for a 176-song
    // playlist. Until everything is in, the count is announced as a floor
    // and the duration (only computable from loaded rows) stays quiet.
    if (!songsQuery.isLoading) {
      const count = songs.length;
      if (songsQuery.hasNextPage) {
        parts.push(t("native.desktop.moreThanSongs", { count }));
      } else {
        parts.push(
          `${count} ${t(
            count === 1
              ? "components.music.PlaylistView.song"
              : "components.music.PlaylistView.songs",
          )}`,
        );
        const { hours, minutes } = splitDuration(totalDuration(songs));
        parts.push(hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`);
      }
    }
    if (system && playlist?.synced_at) {
      parts.push(
        t("native.desktop.syncedOn", {
          date: formatDate(playlist.synced_at, locale),
        }),
      );
    }
    return parts.join(" • ");
  }, [songs, songsQuery.isLoading, songsQuery.hasNextPage, system, playlist, t, locale]);

  const addedAtFor = useCallback(
    (_song: Song, index: number) => rows[index]?.created_at,
    [rows],
  );

  // FR-50: row removal by JOIN-ROW id, optimistic in the mutation itself.
  const extraActionsFor = useCallback(
    (song: Song, index: number): SongMenuItem[] | undefined => {
      if (system) return undefined;
      const row = rows[index];
      if (!row) return undefined;
      return [
        {
          id: "removeFromPlaylist",
          labelKey: "components.music.PlaylistView.removeFromPlaylist",
          icon: "trash",
          destructive: true,
          onPress: () =>
            removeMutation.mutate({
              joinRowId: row.id,
              playlistId,
              songId: song.id,
            }),
        },
      ];
    },
    [system, rows, removeMutation, playlistId],
  );

  // FR-50: reorder ONLY when every page is loaded; COMPLETE song-id array;
  // optimistic page rewrite with rollback on error.
  const fullyLoaded = !songsQuery.hasNextPage && !songsQuery.isLoading;
  const handleReorder = useCallback(
    (fromVisible: number, toVisible: number) => {
      const movedIds = arrayMove(
        songs.map((s) => s.id),
        fromVisible,
        toVisible,
      );
      const key = keys.playlistSongs(playlistId);
      const previous = qc.getQueryData<InfiniteData<PlaylistSong[]>>(key);
      if (previous) {
        const flat = previous.pages.flat();
        const bySongId = new Map(flat.map((r) => [r.song_id, r]));
        const reordered = movedIds
          .map((id) => bySongId.get(id))
          .filter((r): r is PlaylistSong => r != null);
        const pages: PlaylistSong[][] = [];
        let cursor = 0;
        for (const page of previous.pages) {
          pages.push(reordered.slice(cursor, cursor + page.length));
          cursor += page.length;
        }
        qc.setQueryData<InfiniteData<PlaylistSong[]>>(key, { ...previous, pages });
      }
      reorderMutation.mutate(
        { id: playlistId, songIds: movedIds },
        {
          onError: () => {
            if (previous) qc.setQueryData(key, previous);
          },
        },
      );
    },
    [songs, playlistId, qc, reorderMutation],
  );

  const canReorder = !system && fullyLoaded && songs.length > 1;

  const menuItems = useMemo<ActionBarMenuItem[]>(() => {
    const items: ActionBarMenuItem[] = [];
    if (canReorder) {
      items.push({
        id: "reorder",
        label: t(reorderMode ? "native.playlist.reorderDone" : "native.playlist.reorder"),
        icon: reorderMode ? "check" : "grip-vertical",
        onPress: () => setReorderMode((v) => !v),
      });
    }
    if (system) {
      items.push({
        id: "copy",
        label: t("components.music.PlaylistView.copyToEditable"),
        icon: "library",
        disabled: copyMutation.isPending,
        onPress: () =>
          copyMutation.mutate(playlistId, {
            onSuccess: (copy) => router.replace(playlistRoute(copy.id)),
          }),
      });
    }
    items.push({
      id: "delete",
      label: t("components.music.PlaylistView.deletePlaylist"),
      icon: "trash",
      destructive: true,
      onPress: () => setConfirmDelete(true),
    });
    return items;
  }, [system, copyMutation, playlistId, router, t, canReorder, reorderMode]);

  if (playlistQuery.isError) {
    return (
      <ErrorState
        text={t("components.music.PlaylistView.errorLoadingPlaylist")}
        onRetry={() => void playlistQuery.refetch()}
      />
    );
  }

  return (
    <>
      <CollectionScreen
        kind="playlist"
        title={playlist?.name ?? ""}
        subtitle={
          system
            ? t("components.music.PlaylistView.syncedFromSpotify")
            : t("components.music.PlaylistView.playlistLabel")
        }
        meta={playlist ? meta : undefined}
        owner={owner}
        image={playlist && !likedMirror && system ? playlistArtworkSource(playlist) : undefined}
        artworkSlot={
          likedMirror
            ? (size) => <LikedArtwork size={size} />
            : playlist && !system
              ? // Manual playlists only: system playlists never get an editing
                // affordance (FR-53) - the server rejects the upload anyway.
                (size) => (
                  <ChangePlaylistArtwork
                    playlistId={playlistId}
                    source={playlistArtworkSource(playlist)}
                    size={size}
                  />
                )
              : undefined
        }
        accentColor={likedMirror ? LIKED_ACCENT : undefined}
        accentKey={likedMirror ? undefined : `playlist:${playlistId}`}
        // The editable artwork slot hides the real image from the hero, so
        // the accent extraction gets the cover URI explicitly.
        extractionUri={
          playlist && !likedMirror && !system
            ? artworkSourceUri(playlistArtworkSource(playlist))
            : undefined
        }
        songs={songs}
        isLoading={playlistQuery.isLoading || songsQuery.isLoading}
        isError={songsQuery.isError}
        errorText={t("components.music.PlaylistView.errorLoadingSongs")}
        emptyText={t("components.music.PlaylistView.noSongsInPlaylist")}
        onRetry={() => void songsQuery.refetch()}
        addedAtFor={addedAtFor}
        surface="playlist"
        extraActionsFor={system ? undefined : extraActionsFor}
        onReorder={canReorder && reorderMode ? handleReorder : undefined}
        menuItems={menuItems}
        collectionKey={String(playlistId)}
        recentEntry={
          playlist
            ? {
                kind: "playlist",
                key: String(playlistId),
                title: playlist.name,
                artworkNodeId: playlist.artwork_media_id ?? null,
                heart: likedMirror,
              }
            : undefined
        }
        hasMore={songsQuery.hasNextPage}
        isLoadingMore={songsQuery.isFetchingNextPage}
        onLoadMore={() => void songsQuery.fetchNextPage()}
      />
      <ConfirmDialog
        visible={confirmDelete}
        title={t("components.music.PlaylistView.deletePlaylist")}
        message={t("components.music.PlaylistView.areYouSureDeletePlaylist")}
        confirmLabel={t("components.music.PlaylistView.deletePlaylist")}
        destructive
        pending={deleteMutation.isPending}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() =>
          deleteMutation.mutate(playlistId, {
            onSuccess: () => {
              setConfirmDelete(false);
              router.replace("/playlists");
            },
            onError: () => setConfirmDelete(false),
          })
        }
      />
    </>
  );
};
