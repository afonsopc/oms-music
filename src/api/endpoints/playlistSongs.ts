/** Playlist songs REST (join rows). Removal targets the JOIN-ROW id. */
import { request } from "../client";
import { pageModifier } from "../params";
import type { PlaylistId, SongId } from "@/domain/ids";
import type { PlaylistSong } from "@/domain/playlist";

export const PLAYLIST_SONGS_PAGE_SIZE = 100;

/** One position-ordered page (FR-48: infinite pages of 100). */
export const listPlaylistSongsPage = (
  playlistId: PlaylistId,
  page: number,
): Promise<PlaylistSong[]> =>
  request("GET", "/playlist_songs", {
    params: {
      exact_search: { playlist_id: playlistId },
      modifiers: {
        page: pageModifier(page, PLAYLIST_SONGS_PAGE_SIZE),
        order: "position:asc",
      },
    },
  });

/** Membership pre-check for the AddToPlaylist dialog (FR-49). */
export const listSongMemberships = (songId: SongId): Promise<PlaylistSong[]> =>
  request("GET", "/playlist_songs", {
    params: {
      exact_search: { song_id: songId },
      modifiers: { page: pageModifier(1, 500) },
    },
  });

/** 400 "Song has already been taken" on duplicates; pre-check instead. */
export const addPlaylistSong = (
  playlistId: PlaylistId,
  songId: SongId,
): Promise<PlaylistSong> =>
  request("POST", "/playlist_songs", { body: { playlist_id: playlistId, song_id: songId } });

/** :id is the JOIN-ROW id, not the song id. */
export const removePlaylistSong = (joinRowId: number): Promise<void> =>
  request("DELETE", `/playlist_songs/${joinRowId}`);
