import type { FsNodeId, SongKey } from "./ids";

export type DownloadKind = "mixed" | "mixed_original" | "artwork" | "vocal" | "instrumental";
export type DownloadFileStatus = "queued" | "downloading" | "done" | "error";
export type SongDownloadStatus = "none" | "queued" | "downloading" | "done" | "error";

/** Mirrors the dl_files row (DESIGN.md 9.1). */
export interface DownloadEntry {
  song_key: SongKey;
  kind: DownloadKind;
  status: DownloadFileStatus;
  node_id: FsNodeId;
  sibling_node_id: FsNodeId | null;
  filename: string;
  local_uri: string | null;
  progress: number;
  size_bytes: number;
  savable: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

/** FR-81 tri-state: never fetched / confirmed none / cached. */
export type LyricsState = "unfetched" | "none" | "cached";
