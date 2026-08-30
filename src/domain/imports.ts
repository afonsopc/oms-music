import type { MusicExternalAlbum, MusicExternalArtist } from "@omelhorsite/sdk";
import type { PlaylistId, SongId, UserId } from "./ids";

export interface SongImport {
  id: number;
  created_at: string;
  updated_at: string;
  user_id: UserId;
  playlist_id: PlaylistId | null;
  song_id: SongId | null;
  source_url: string | null;
  source_provider: string | null;
  source_id: string | null;
  source_kind: "yt_dlp" | "spotify_sync" | null;
  override_title: string | null;
  override_artist: string | null;
  override_album: string | null;
  expected_duration_s: number | null;
  position: number | null;
  sidecar_request_id: string | null;
  state: "pending" | "processing" | "complete" | "failed";
  progress_message: string | null;
  progress_pct: number | null; // FLOAT 0..1
  error_message: string | null;
  deduped: boolean;
}

export type ExternalSource = "spotify" | "youtube" | "soundcloud" | "bandcamp" | "itunes";

export interface ExternalSearchResult {
  source: ExternalSource;
  kind: string;
  source_id: string;
  source_url: string | null;
  title: string;
  artist: string;
  album: string | null;
  duration_ms: number | null;
  isrc: string | null;
  artwork_url: string | null;
}

/**
 * GET /music/external_search. Only `tracks` is rendered; the album and artist
 * hits keep the SDK's shapes (`MusicExternalAlbum` / `MusicExternalArtist`).
 */
export interface ExternalSearchResponse {
  tracks: ExternalSearchResult[];
  albums: MusicExternalAlbum[];
  artists: MusicExternalArtist[];
}

/** POST /playlist_imports/preview response. */
export type DownloaderPreview =
  | {
      kind: "track";
      title?: string;
      artist?: string;
      album?: string;
      duration_s?: number;
      thumbnails?: { url: string; width?: number; height?: number }[];
      webpage_url?: string;
      id?: string;
      extractor?: string;
    }
  | {
      kind: "playlist";
      title?: string;
      id?: string;
      count: number;
      tracks: {
        title?: string;
        artist?: string;
        album?: string;
        duration_s?: number;
        webpage_url?: string;
        id?: string;
      }[];
    };

export interface ArtworkSearchItem {
  url: string;
  thumb_url?: string;
  source: "itunes" | "musicbrainz" | "deezer";
  width?: number;
  height?: number;
  label?: string;
  subtitle?: string;
}

export interface SpotifySyncStatus {
  connected: boolean;
  identity_id?: string;
  spotify_user_name?: string;
  last_synced_at?: string | null;
  sync_settings?: {
    sync_liked?: boolean;
    enabled_playlists?: string[] | null;
    auto_sync?: boolean;
  };
  sync_progress?: {
    state: "idle" | "running" | "complete" | "failed";
    started_at: string | null;
    finished_at: string | null;
    error: string | null;
    playlists: {
      id: string;
      name: string;
      total: number | null;
      queued: number;
      skipped: number;
      state: "pending" | "running" | "complete" | "failed";
    }[];
  };
}

export interface SpotifySyncPreview {
  sync_liked: boolean;
  playlists: {
    id: string;
    name: string;
    track_count: number | null;
    owner: string | null;
    cover_url: string | null;
    enabled: boolean;
  }[];
}

export interface ArtistImportSearchResponse {
  roster: { kind: "roster"; id: number; name: string; slug: string; image_url: string | null }[];
  spotify: {
    kind: "spotify";
    id: string;
    name: string;
    followers: number | null;
    genres: string[];
    image_url: string | null;
    external_url: string | null;
  }[];
}

export interface ArtistImportAlbum {
  id: string;
  name: string;
  album_type: string;
  album_group: string;
  release_date: string | null;
  total_tracks: number | null;
  image_url: string | null;
  external_url: string | null;
}

export interface ArtistImport {
  id: number;
  created_at: string;
  updated_at: string;
  user_id: UserId;
  spotify_artist_id: string;
  spotify_artist_name: string;
  album_ids: string[];
  state: "queued" | "running" | "complete" | "failed";
  total_albums: number | null;
  total_tracks: number | null;
  processed_albums: number | null;
  queued_count: number | null;
  skipped_count: number | null;
  failed_count: number | null;
  last_message: string | null;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
}
