/**
 * Playback mode -> fs node selection (FR-56/68). Pure. `custom` plays the
 * plain mix in v1 (DESIGN 16.1): the wire value round-trips untouched while
 * the audio path is the stems-missing fallback.
 */
import type { FsNodeId } from "@/domain/ids";
import type { PlaybackMode } from "@/domain/playback";
import type { Song } from "@/domain/song";
import type { DownloadKind } from "@/domain/downloads";

/** Stem node for the file modes; null for original/custom or a missing stem. */
export const stemNodeIdForMode = (song: Song, mode: PlaybackMode): FsNodeId | null => {
  if (mode === "instrumental") return song.instrumental_fs_node_id ?? null;
  if (mode === "vocals") return song.vocals_fs_node_id ?? null;
  return null;
};

/**
 * The fs node the player should stream for a song in a given mode:
 * stem node when the mode wants one and it exists, else
 * compressed_audio_fs_node_id || audio_fs_node_id (compressed preferred).
 */
export const wantedNodeId = (song: Song, mode: PlaybackMode): FsNodeId | null =>
  stemNodeIdForMode(song, mode) ??
  song.compressed_audio_fs_node_id ??
  song.audio_fs_node_id ??
  null;

/** Whether the mode is actually playing a stem file for this song. */
export const modeUsesStem = (song: Song, mode: PlaybackMode): boolean =>
  stemNodeIdForMode(song, mode) !== null;

/** Local download kinds to try, best first, for a song in a given mode. */
export const localKindsForMode = (song: Song, mode: PlaybackMode): DownloadKind[] => {
  if (mode === "instrumental" && song.instrumental_fs_node_id) return ["instrumental"];
  if (mode === "vocals" && song.vocals_fs_node_id) return ["vocal"];
  // Plain mix: the original master is a quality upgrade (may fail iOS
  // decode and silently fall through), then the compressed mix.
  return ["mixed_original", "mixed"];
};
