import type { JamId, UserId } from "./ids";
import type { SnapshotSong } from "./song";

export interface Jam {
  id: JamId;
  host_id: UserId;
  queue_mode: "everyone" | "host";
  skip_mode: "majority" | "host" | "anyone";
  created_at: string;
  ended_at: string | null;
  members: {
    id: UserId;
    handle: string;
    name: string;
    is_host: boolean;
    joined_at: string;
  }[];
}

export interface JamState {
  song: (SnapshotSong & { audio_url: string }) | null;
  position: number;
  paused: boolean;
  upcoming?: {
    id: string;
    title: string;
    duration: number;
    artist_names: string[];
    artwork_url: string | null;
    proposer: { id: UserId; handle: string } | null;
  }[];
  server_time: number; // epoch ms
}

/** POST /jams/:id/skip_vote response. */
export interface SkipVoteResult {
  skipped: boolean;
  count: number;
  needed: number;
}

/** GET /jams response. */
export interface JamsIndex {
  current: Jam | null;
  joinable: Jam[];
}
