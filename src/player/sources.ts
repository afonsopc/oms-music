/**
 * Source candidate ladder (FR-55/56/90; DESIGN 8.2). The engine tries each
 * candidate until one is accepted (first status without error); an error
 * BEFORE audiblePlaying moves to the next candidate, never into the failure
 * ladder - that is how FLAC-on-iOS local masters silently fall back.
 */
import type { Song } from "@/domain/song";
import type { PlaybackMode } from "@/domain/playback";
import type { FsNodeId } from "@/domain/ids";
import { toSongKey } from "@/domain/ids";
import { getLocalFileIndex } from "@/contracts/localSource";
import { localKindsForMode, wantedNodeId } from "./modes";

export type SourceCandidate =
  | { kind: "jam"; uri: string }
  | { kind: "local"; uri: string }
  | { kind: "network"; nodeId: FsNodeId };

export interface ResolvedSources {
  /** The fs node the player is being pointed at (null for jam proposals). */
  wantedNodeId: FsNodeId | null;
  candidates: SourceCandidate[];
}

/**
 * Ladder: 1) jam audio_url verbatim (single candidate; never resolve another
 * user's fs nodes); 2) local files via the LocalFileIndex (file:// uris);
 * 3) the network node via the presigned resolver.
 */
export const resolveSources = (song: Song, mode: PlaybackMode): ResolvedSources => {
  if (song.audio_url) {
    return { wantedNodeId: null, candidates: [{ kind: "jam", uri: song.audio_url }] };
  }
  const wanted = wantedNodeId(song, mode);
  const candidates: SourceCandidate[] = [];
  const index = getLocalFileIndex();
  const key = toSongKey(song.id);
  for (const kind of localKindsForMode(song, mode)) {
    const uri = index.get(key, kind);
    if (uri) candidates.push({ kind: "local", uri });
  }
  if (wanted) candidates.push({ kind: "network", nodeId: wanted });
  return { wantedNodeId: wanted, candidates };
};

/** True when playback of this song/mode would have to hit the network. */
export const wouldHitNetwork = (song: Song, mode: PlaybackMode): boolean => {
  const { candidates } = resolveSources(song, mode);
  return candidates.length > 0 && candidates[0]!.kind === "network";
};
