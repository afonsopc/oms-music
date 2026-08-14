import type { FsNodeId, PlaylistId, SongId, UserId } from "./ids";
import type { Song } from "./song";

export interface Playlist {
  id: PlaylistId;
  created_at: string;
  updated_at: string;
  name: string;
  user_id: UserId;
  artwork_media_id: FsNodeId | null;
  source_kind: "manual" | "spotify_sync" | "imported" | null;
  source_provider: string | null;
  source_url: string | null;
  source_external_id: string | null; // "liked" = Spotify liked mirror
  synced_at: string | null;
}

/** System playlists are read-only server-side (rename included). */
export const isSystemPlaylist = (p: Playlist): boolean =>
  !!p.source_kind && p.source_kind !== "manual";

export const isLikedMirror = (p: Playlist): boolean =>
  p.source_external_id === "liked";

export interface PlaylistSong {
  /** JOIN-ROW id (DELETE /playlist_songs/:id uses this, not the song id). */
  id: number;
  created_at: string;
  updated_at: string;
  playlist_id: PlaylistId;
  song_id: SongId;
  position: number;
  song: Song;
}

export interface LikedSong {
  id: number;
  created_at: string;
  updated_at: string;
  user_id: UserId;
  song_id: SongId;
  liked_at: string;
  song: Song;
}
