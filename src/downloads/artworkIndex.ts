/**
 * Reverse index fs node id -> song key for downloaded artwork (FR-91, the
 * "offline image resolver for ArtworkImage" of DESIGN 9.4).
 *
 * The LocalFileIndex is keyed by (songKey, kind), which only answers for
 * surfaces that know WHICH song they are drawing. Album tiles, the artist
 * album grid, the home rails and the library rows all render artwork as a
 * bare fs node (`deriveOfflineAlbums` carries an `artwork_media_id` and
 * nothing else), so without this map they fall through to the placeholder in
 * airplane mode even though the jpg is on disk.
 *
 * Both artwork node ids of a song map to its ONE downloaded artwork file:
 * the bundle stores compressed-first, while a derived row may quote either
 * id. Pure and bun-tested; the manager owns the instance and the lifetime.
 */
import type { FsNodeId, SongKey } from "@/domain/ids";
import type { Song } from "@/domain/song";

type ArtworkCarrier = Pick<Song, "artwork_media_id" | "compressed_artwork_media_id">;

/** Every node id under which this song's artwork can be requested. */
export const artworkNodeIdsOf = (song: ArtworkCarrier): FsNodeId[] => {
  const ids: FsNodeId[] = [];
  for (const id of [song.compressed_artwork_media_id, song.artwork_media_id]) {
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
};

export class ArtworkNodeIndex {
  /** A node id can be quoted by more than one song (shared album art). */
  private readonly byNode = new Map<FsNodeId, SongKey[]>();

  add(songKey: SongKey, song: ArtworkCarrier): void {
    for (const nodeId of artworkNodeIdsOf(song)) {
      const keys = this.byNode.get(nodeId);
      if (!keys) {
        this.byNode.set(nodeId, [songKey]);
      } else if (!keys.includes(songKey)) {
        keys.push(songKey);
      }
    }
  }

  remove(songKey: SongKey, song: ArtworkCarrier): void {
    for (const nodeId of artworkNodeIdsOf(song)) {
      const keys = this.byNode.get(nodeId);
      if (!keys) continue;
      const next = keys.filter((key) => key !== songKey);
      if (next.length === 0) this.byNode.delete(nodeId);
      else this.byNode.set(nodeId, next);
    }
  }

  /** Candidate song keys, newest registration last (caller picks the first
   *  one that actually has the file on disk). */
  songKeysFor(nodeId: FsNodeId): readonly SongKey[] {
    return this.byNode.get(nodeId) ?? [];
  }

  clear(): void {
    this.byNode.clear();
  }
}
