/** Playlists REST (API.md section 6). System playlists reject rename,
 *  artwork, add/remove/reorder server-side; DELETE and COPY are allowed. */
import { request } from "../client";
import { pageModifier } from "../params";
import type { ListFilters } from "@/domain/api";
import type { PlaylistId, SongId } from "@/domain/ids";
import type { Playlist } from "@/domain/playlist";

export const listPlaylists = (filters: ListFilters = {}): Promise<Playlist[]> =>
  request("GET", "/playlists", {
    params: {
      modifiers: { page: pageModifier(1, 500) },
      ...filters,
    },
  });

export const getPlaylist = (id: PlaylistId): Promise<Playlist> =>
  request("GET", `/playlists/${id}`);

/** song_ids seeds <= 500 songs, order preserved (radio save-as-playlist). */
export const createPlaylist = (body: {
  name: string;
  artwork_media_id?: string;
  song_ids?: SongId[];
}): Promise<Playlist> => request("POST", "/playlists", { body });

export const updatePlaylist = (
  id: PlaylistId,
  body: { name?: string; artwork_media_id?: string | null },
): Promise<Playlist> => request("PATCH", `/playlists/${id}`, { body });

export const deletePlaylist = (id: PlaylistId): Promise<void> =>
  request("DELETE", `/playlists/${id}`);

/** Send the COMPLETE desired song-id order; ignore the body, refetch. */
export const reorderPlaylist = (id: PlaylistId, songIds: SongId[]): Promise<unknown> =>
  request("POST", `/playlists/${id}/reorder`, { body: { song_ids: songIds } });

/** Multipart field name is `artwork` (JPEG <= ~2MB from the crop flow). */
export const uploadPlaylistArtwork = (
  id: PlaylistId,
  artwork: { uri: string; name: string; type: string },
): Promise<Playlist> => {
  const formData = new FormData();
  formData.append("artwork", artwork as unknown as Blob);
  return request("POST", `/playlists/${id}/upload_artwork`, { formData });
};

/** Works on system playlists; navigates to the returned copy. */
export const copyPlaylist = (id: PlaylistId): Promise<Playlist> =>
  request("POST", `/playlists/${id}/copy`);
