import type { UserId } from "./ids";
import type { Artist } from "./artist";
import type { SnapshotSong } from "./song";

export interface FriendListening {
  user: { id: UserId; handle: string; name: string };
  song: SnapshotSong | null; // null when sharing off
  paused: boolean;
  online: boolean;
  jam_id: number | null;
  updated_at: string | null;
}

export interface MusicProfile {
  visible: boolean;
  now_playing?: FriendListening;
  top_artists?: (Pick<
    Artist,
    | "id"
    | "name"
    | "slug"
    | "picture"
    | "picture_medium"
    | "picture_big"
    | "picture_xl"
    | "external_image_url"
  > & { image_url: string | null; play_count: number })[];
  top_songs?: (SnapshotSong & { play_count: number })[];
  recent?: (SnapshotSong & { last_played_at: string })[];
  plays_30d?: number;
}
