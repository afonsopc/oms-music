import type { ArtistId, FsNodeId, UserId } from "./ids";

export interface Artist {
  id: ArtistId;
  created_at: string;
  updated_at: string;
  name: string;
  canonical_name: string;
  slug: string;
  user_id: UserId;
  image_fs_node_id: FsNodeId | null;
  compressed_image_fs_node_id: FsNodeId | null;
  banner_fs_node_id: FsNodeId | null;
  compressed_banner_fs_node_id: FsNodeId | null;
  mbid: string | null;
  lastfm_listeners: number | null;
  lastfm_playcount: number | null;
  external_image_url: string | null;
  picture: string | null;
  picture_small: string | null;
  picture_medium: string | null;
  picture_big: string | null;
  picture_xl: string | null;
  pictures_fetched_at: string | null;
  bio_fetched_at: string | null;
  similar_fetched_at: string | null;
  songs_count: number;
  fallback_artwork_fs_node_id: FsNodeId | null;
  // extended view (show/update) only:
  bio_html?: string | null;
  gallery_image_urls?: string[];
  similar?: { name: string; match: number; mbid: string | null }[];
}

export interface ArtistOverview {
  stats: { artists: number; songs: number; new_artists: number; seconds_played: number };
  heavy_rotation_window: "30d" | "all";
  spotlight: {
    artist: Artist;
    songs_count: number;
    albums_count: number;
    play_count: number;
  } | null;
  heavy_rotation: { artist: Artist; play_count: number }[];
  similar: { seed: Artist; artists: Artist[] } | null;
  neglected: { artist: Artist; songs_count: number }[];
}

/** GET /artist_metadata/:name legacy shim payload (always 200). */
export interface ArtistMetadata {
  id: ArtistId | null;
  name: string;
  slug: string | null;
  mbid: string | null;
  lastfm_listeners: number | null;
  lastfm_playcount: number | null;
  bio_html: string | null;
  image_url: string | null;
  image_fs_node_id: FsNodeId | null;
  compressed_image_fs_node_id: FsNodeId | null;
  banner_fs_node_id: FsNodeId | null;
  compressed_banner_fs_node_id: FsNodeId | null;
  picture: string | null;
  picture_small: string | null;
  picture_medium: string | null;
  picture_big: string | null;
  picture_xl: string | null;
  similar: { name: string; match: number; mbid: string | null }[];
}
