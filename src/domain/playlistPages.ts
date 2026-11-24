/** Pure edits of the loaded pages of a playlist (optimistic add). */
import type { InfiniteData } from "@tanstack/react-query";
import type { PlaylistId, SongId } from "./ids";
import type { PlaylistSong } from "./playlist";
import type { Song } from "./song";

export const PLAYLIST_SONGS_PAGE_SIZE = 100;

/** Appends a pending row (negative id) when the last page is fully loaded. */
export const withSongAppended = (
  data: InfiniteData<PlaylistSong[]>,
  playlistId: PlaylistId,
  song: Song,
): InfiniteData<PlaylistSong[]> => {
  const last = data.pages[data.pages.length - 1];
  if (!last || last.length >= PLAYLIST_SONGS_PAGE_SIZE) return data;
  if (data.pages.some((page) => page.some((row) => row.song_id === song.id))) return data;
  const now = new Date().toISOString();
  const row: PlaylistSong = {
    id: -Number(song.id),
    created_at: now,
    updated_at: now,
    playlist_id: playlistId,
    song_id: song.id,
    position: (last[last.length - 1]?.position ?? 0) + 1,
    song,
  };
  return { ...data, pages: [...data.pages.slice(0, -1), [...last, row]] };
};

export const withoutPendingSong = (
  data: InfiniteData<PlaylistSong[]>,
  songId: SongId,
): InfiniteData<PlaylistSong[]> => ({
  ...data,
  pages: data.pages.map((page) => page.filter((row) => !(row.id < 0 && row.song_id === songId))),
});
