/**
 * Media-id reconciliation: the ONE staleness signal cached media needs.
 *
 * Media ids are ActiveStorage attachment ids serialized as decimal strings,
 * and replacing an attachment mints a NEW attachment and therefore a NEW id.
 * That makes every id-keyed cache self-healing for free: the expo-image
 * `cacheKey` on ArtworkImage, the ArtworkNodeIndex, the desktop `/m/<id>`
 * protocol path and artworkPrefetch's `getCachePathAsync(mediaId)` all miss
 * and refetch the moment the server hands out a different id.
 *
 * `dl_files` is the exception, and it was a real hole: the table is keyed by
 * (song_key, kind) with node_id as a mere PAYLOAD, `enqueueKind` returned
 * early on `status = 'done'` without ever comparing ids, and `verifySongFiles`
 * only checked that a file existed. A re-transcoded song played its old bytes
 * forever. This module is the comparison that closes it.
 *
 * Everything here is PURE and imports nothing outside `src/domain/`: it is
 * consumed by the manager on a hot enqueue path, by the repair walk, and by
 * bun tests that cannot load expo-sqlite. Bytes are immutable once written,
 * so we never revalidate them over HTTP - we version-bust the key instead.
 */
import type { DownloadKind } from "@/domain/downloads";
import type { FsNodeId, SongId, SongKey } from "@/domain/ids";
import type { Song } from "@/domain/song";

/**
 * True when the stored row is complete but points at DIFFERENT content than
 * the caller now wants. A queued or errored row is never "stale": it has no
 * bytes to be wrong about, and the upsert rewrites its node_id anyway.
 *
 * Signature frozen by the design (section 8.2) because `enqueueKind` calls it
 * on every dedup check; do not widen it without telling the manager's owner.
 */
export const isStaleForNode = (
  row: { node_id: string; status: string } | null,
  wantedNodeId: string,
): boolean => !!row && row.status === "done" && row.node_id !== wantedNodeId;

/**
 * The (kind -> media id) map the CURRENT Song payload wants, mirroring
 * `downloadSong`'s selection exactly:
 *  - `mixed` prefers the compressed transcode and falls back to the master;
 *  - `mixed_original` exists only when the master is a DISTINCT id, because
 *    downloading the same bytes twice under two kinds is pure waste;
 *  - `artwork` prefers the compressed cover;
 *  - the two stems are unconditional when the server has them.
 *
 * Kept next to `isStaleForNode` rather than inside the manager so the repair
 * walk and the tests read the same table the enqueue does. If `downloadSong`
 * ever changes which id feeds which kind, it changes HERE too or the repair
 * pass starts dropping perfectly good files.
 */
export const wantedNodes = (song: Song): Partial<Record<DownloadKind, FsNodeId>> => {
  const wanted: Partial<Record<DownloadKind, FsNodeId>> = {};

  const mixed = song.compressed_audio_media_id || song.audio_media_id;
  if (mixed) wanted.mixed = mixed;
  if (song.audio_media_id && song.audio_media_id !== song.compressed_audio_media_id) {
    wanted.mixed_original = song.audio_media_id;
  }

  const artwork = song.compressed_artwork_media_id || song.artwork_media_id;
  if (artwork) wanted.artwork = artwork;

  if (song.vocals_media_id) wanted.vocal = song.vocals_media_id;
  if (song.instrumental_media_id) wanted.instrumental = song.instrumental_media_id;

  return wanted;
};

/** The five ids a Song payload carries, in a stable order. */
const MEDIA_ID_FIELDS = [
  "compressed_audio_media_id",
  "audio_media_id",
  "compressed_artwork_media_id",
  "artwork_media_id",
  "vocals_media_id",
  "instrumental_media_id",
] as const;

/**
 * True when a payload actually CARRIES the media-id fields, rather than merely
 * not having values for them.
 *
 * This is the difference between "the server dropped this attachment" and "the
 * list endpoint that produced this row does not serialize attachments at all",
 * and the two are indistinguishable once the payload has been cast to Song:
 * both read as `undefined`. `extractSongs` admits anything with a numeric
 * `id`, from playlistSongs, songs.byAlbum/list/infinite and liked, so a single
 * trimmed row in any of those would make the reconciliation conclude that a
 * perfectly good downloaded file is stale - and drop it.
 *
 * The compressed pair is the probe because it is the pair `downloadSong`
 * chooses `mixed` and `artwork` from; a payload that serializes attachments at
 * all serializes those two, null included.
 */
export const hasMediaIdFields = (song: Song): boolean =>
  "compressed_audio_media_id" in song && "compressed_artwork_media_id" in song;

/**
 * True when two payloads for the same song disagree about ANY media id.
 *
 * This is what makes the repair pass able to notice a re-transcode at all.
 * `downloadSong` skips the metadata upsert when `updated_at` matches, so if
 * the backend replaces an attachment WITHOUT touching the record (see the
 * design's section 8.4 question) the stored JSON would keep the old ids
 * forever even though the server is serving new ones. Comparing the ids
 * themselves is immune to that: it observes the thing that actually matters
 * instead of a proxy for it.
 */
export const mediaIdsChanged = (a: Song, b: Song): boolean =>
  MEDIA_ID_FIELDS.some((field) => (a[field] ?? null) !== (b[field] ?? null));

/**
 * The stored rows that hold the WRONG bytes for this payload. `done` rows
 * only: a queued row has nothing to be wrong about, and a row for a kind the
 * payload no longer wants at all (a stem the server dropped) is not stale
 * either - it is simply extra, and removeDownload is what clears those.
 */
export const staleKinds = (
  song: Song,
  rows: readonly { kind: DownloadKind; node_id: string; status: string }[],
): DownloadKind[] => {
  const wanted = wantedNodes(song);
  const stale: DownloadKind[] = [];
  for (const row of rows) {
    const want = wanted[row.kind];
    if (!want) continue;
    if (isStaleForNode(row, want)) stale.push(row.kind);
  }
  return stale;
};

// ---------------------------------------------------------------------------
// The repair pass's payload choice
// ---------------------------------------------------------------------------

export interface StoredSongRef {
  songKey: SongKey;
  song: Song;
}

export interface ReconciliationItem {
  songKey: SongKey;
  /** The payload to re-issue: the FRESH one whenever we have it. */
  song: Song;
  /** True when the fresh payload disagrees with the stored one about bytes. */
  stale: boolean;
  /** True when a fresher payload was available at all (diagnostics only). */
  refreshed: boolean;
}

/**
 * Decides, per stored song, which Song payload the repair walk should hand to
 * `downloadSong`.
 *
 * The walk used to re-issue the STORED payload, which made reconciliation
 * structurally impossible: the stored ids were compared against themselves
 * and always matched. Feeding it a fresher payload - the react-query cache
 * already holds one for anything the user or the warm-up sweep has looked at
 * - is what lets `enqueueKind`'s media-id check fire, drop the wrong bytes
 * and re-enqueue. When no fresh payload exists the stored one is used and the
 * pass behaves exactly as it always did, so an offline repair is unchanged.
 *
 * Pure on purpose: "which payload wins" is the part that is easy to get
 * subtly wrong and impossible to test through SQLite and the network.
 */
export const planReconciliation = (
  stored: readonly StoredSongRef[],
  fresh: ReadonlyMap<SongId, Song>,
): ReconciliationItem[] =>
  stored.map((entry) => {
    const newer = fresh.get(entry.song.id);
    if (!newer) {
      return { songKey: entry.songKey, song: entry.song, stale: false, refreshed: false };
    }
    return {
      songKey: entry.songKey,
      song: newer,
      stale: mediaIdsChanged(entry.song, newer),
      refreshed: true,
    };
  });
