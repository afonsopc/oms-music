import type { FsNodeId, SongId, UserId } from "./ids";

/** song_artists JOIN row as embedded in Song payloads (API.md section 5). */
export interface SongArtistEntry {
  id: number;
  song_id: number;
  artist_id: number;
  position: number;
  role: "primary" | "featured" | "with";
  name: string;
  slug: string;
  image_fs_node_id: FsNodeId | null;
  compressed_image_fs_node_id: FsNodeId | null;
  picture: string | null;
  picture_medium: string | null;
  external_image_url: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * The `artist_names` display field. Every backend serializer that emits it
 * (`Listening::Snapshot.song_hash`, `Jams::Serializer`) joins the names with
 * ", " into a single STRING; array payloads survive from the web's legacy
 * shape. Never index or `.join()` it: go through `domain/format`'s
 * `artistNamesLine` / `artistNamesList`.
 */
export type ArtistNames = string | string[];

export interface Song {
  id: SongId;
  created_at: string;
  updated_at: string;
  title: string;
  album: string | null;
  duration: number;
  position: number | null;
  year: number | null;
  audio_fs_node_id: FsNodeId | null;
  compressed_audio_fs_node_id: FsNodeId | null;
  artwork_fs_node_id: FsNodeId | null;
  compressed_artwork_fs_node_id: FsNodeId | null;
  vocals_fs_node_id: FsNodeId | null;
  instrumental_fs_node_id: FsNodeId | null;
  vocal_separation_started_at: string | null;
  user_id: UserId;
  source_kind: "upload" | "yt_dlp" | "spotify_sync" | null;
  source_provider: string | null;
  source_url: string | null;
  source_id: string | null;
  isrc: string | null;
  original_filename: string | null;
  audio_codec: string | null;
  audio_bitrate_kbps: number | null;
  audio_sample_rate_hz: number | null;
  audio_channels: number | null;
  audio_lossless: boolean | null;
  audio_filesize_bytes: number | null;
  artists: SongArtistEntry[];
  // jam-injected extras (present only on jam proposal entries)
  audio_url?: string;
  artwork_url?: string | null;
  artist_names?: ArtistNames;
  jam_song?: true;
  jam_proposer?: { id: UserId; handle: string; name: string };
}

/** Cross-user song shape used by feeds, jams and profiles (SnapshotSong). */
export interface SnapshotSong {
  id: string;
  title: string;
  album: string | null;
  duration: number;
  owner_id: UserId;
  artist_names: ArtistNames;
  artwork_url: string | null; // presigned
}

/** VocalSeparation extended view. NO "canceled" status exists server-side. */
export interface VocalSeparation {
  id: string;
  created_at: string;
  updated_at: string;
  status: "pending" | "processing" | "complete" | "failed";
  model_id: string | null;
  duration_seconds: number | null;
  error: string | null;
  finished_at: string | null;
  song_id: SongId;
  user_id: UserId;
  ip_address: string | null;
  has_vocals: boolean;
  has_instrumental: boolean;
  has_original: boolean;
  song_title: string | null;
  progress_percent: number | null;
  queue_position: number | null;
  vocals_url: string | null;
  instrumental_url: string | null;
}

/** GET /songs/:id/separation response. */
export interface SongSeparationStatus {
  stems_ready: boolean;
  vocals_fs_node_id: FsNodeId | null;
  instrumental_fs_node_id: FsNodeId | null;
  progress_percent: number | null;
  job: VocalSeparation | null;
}
