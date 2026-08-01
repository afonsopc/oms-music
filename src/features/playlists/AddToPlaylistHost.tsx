/**
 * The one AddToPlaylist dialog instance (FR-49), wired over WP4's shell:
 * non-system playlists only, membership pre-check via
 * GET /playlist_songs?exact_search[song_id]=, toggle add (closes) / remove
 * by JOIN-ROW id (stays open), inline create-and-add. Duplicates show a
 * check instead of bouncing off the server uniqueness 400.
 */
import React, { useMemo } from "react";
import { useAddPlaylistSong, useRemovePlaylistSong, useSongMemberships } from "@/api/queries/playlistSongs";
import { useCreatePlaylist, usePlaylists } from "@/api/queries/playlists";
import { playlistArtworkSource } from "@/domain/artwork";
import { toSongId } from "@/domain/ids";
import { isSystemPlaylist } from "@/domain/playlist";
import type { PlaylistId, SongId } from "@/domain/ids";
import { AddToPlaylistDialog, type AddToPlaylistRow } from "@/ui";
import { closeAddToPlaylist, useAddToPlaylistSong } from "./addToPlaylist";

export const AddToPlaylistHost = ({ children }: { children?: React.ReactNode }) => {
  const song = useAddToPlaylistSong();
  const open = song != null;
  // Jam-injected entries carry string ids on some surfaces; normalize.
  const songId: SongId | null =
    song != null
      ? typeof song.id === "number"
        ? song.id
        : toSongId(String(song.id))
      : null;

  const playlistsQuery = usePlaylists({ enabled: open });
  const membershipsQuery = useSongMemberships(songId, open);

  const rows = useMemo<AddToPlaylistRow[] | undefined>(() => {
    if (!playlistsQuery.data) return undefined;
    const joinRowByPlaylist = new Map<number, number>();
    for (const ps of membershipsQuery.data ?? []) {
      joinRowByPlaylist.set(ps.playlist_id, ps.id);
    }
    return playlistsQuery.data
      .filter((p) => !isSystemPlaylist(p))
      .map((p) => ({
        id: p.id,
        name: p.name,
        artwork: playlistArtworkSource(p),
        memberJoinRowId: joinRowByPlaylist.get(p.id) ?? null,
      }));
  }, [playlistsQuery.data, membershipsQuery.data]);

  const addMutation = useAddPlaylistSong();
  const removeMutation = useRemovePlaylistSong();
  const createMutation = useCreatePlaylist();

  const handleToggle = (row: AddToPlaylistRow) => {
    if (songId == null) return;
    if (row.memberJoinRowId != null) {
      // Remove keeps the dialog open (web parity).
      removeMutation.mutate({
        joinRowId: row.memberJoinRowId,
        playlistId: row.id as PlaylistId,
        songId,
      });
    } else {
      addMutation.mutate(
        { playlistId: row.id as PlaylistId, songId },
        { onSuccess: () => closeAddToPlaylist() },
      );
    }
  };

  const handleCreateAndAdd = (name: string) => {
    if (songId == null) return;
    createMutation.mutate(
      { name },
      {
        onSuccess: (playlist) => {
          addMutation.mutate(
            { playlistId: playlist.id, songId },
            { onSettled: () => closeAddToPlaylist() },
          );
        },
      },
    );
  };

  return (
    <>
      {children}
      {song ? (
        <AddToPlaylistDialog
          visible={open}
          onClose={closeAddToPlaylist}
          songTitle={song.title}
          rows={rows}
          loading={playlistsQuery.isLoading || membershipsQuery.isLoading}
          error={playlistsQuery.isError}
          onToggle={handleToggle}
          onCreateAndAdd={handleCreateAndAdd}
          createPending={createMutation.isPending || addMutation.isPending}
        />
      ) : null}
    </>
  );
};
