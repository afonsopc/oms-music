/**
 * Predictive prefetch vocabulary (local-first media layer, owner request
 * 2026-08-14). Deliberately platform-agnostic and dependency-free: the whole
 * point of the policy module is that it can be reasoned about (and bun-tested)
 * without a device, a database or a network stack anywhere near it.
 *
 * Import rule for this whole directory's PURE half (types / constants /
 * policy / geometry / gates): nothing outside `src/domain/`. The impure half
 * (driver, register) is where React-free module state and the platform host
 * live.
 */
import type { MediaId, SongKey } from "@/domain/ids";
import type { Song } from "@/domain/song";

/** The minimum a row must expose for the policy to want anything from it. */
export interface PrefetchSong {
  songKey: SongKey;
  /** compressed_audio_media_id || audio_media_id. Null = not prefetchable. */
  audioMediaId: MediaId | null;
  /** compressed_artwork_media_id || artwork_media_id. */
  artworkMediaId: MediaId | null;
  /** Jam proposals are never prefetchable, at any rank. */
  jam: boolean;
  /**
   * Back-reference to the row the four fields above were derived from.
   *
   * The POLICY never reads it - it is not part of the arbitration and no test
   * asserts on it. The platform host does: the native tier writes a file whose
   * EXTENSION comes from the song's codec (paths.filenameFor), and a
   * predictive fetch that landed as `123_mixed.bin` would be a file the audio
   * stack cannot open on iOS. Carrying the source row is cheaper and far less
   * fragile than rebuilding a second songKey -> Song registry beside the two
   * that already exist.
   */
  song: Song;
}

export interface CollectionSignal {
  key: string;
  songs: readonly PrefetchSong[];
}

export interface ViewportSignal {
  /** Row nearest the viewport centre. Null when geometry is unknown. */
  centerIndex: number | null;
  /** Inclusive row range on screen. Null when geometry is unknown. */
  first: number | null;
  last: number | null;
}

export interface QueueSignal {
  songs: readonly PrefetchSong[];
  /** Index into `songs` of the track playing now. */
  currentIndex: number;
  /** Seconds left on the current track, or null when not playing. */
  remainingS: number | null;
  /** loopMode === "one" suppresses next-track wants entirely. */
  loopOne: boolean;
}

export interface PrefetchSignals {
  collection: CollectionSignal | null;
  viewport: ViewportSignal;
  queue: QueueSignal | null;
  /**
   * `songKey::kind` strings already resident or already in flight, where
   * `kind` is the WANT kind ("audio" / "artwork"), not the storage kind.
   * The policy never learns what "mixed" means; that translation belongs to
   * the driver's host, which is the only side that knows about dl_files.
   */
  resident: ReadonlySet<string>;
}

export type WantKind = "audio" | "artwork";

export type WantReason =
  | "queue-next"
  | "collection-first"
  | "viewport-center"
  | "queue-prev"
  | "viewport-artwork";

export interface PrefetchWant {
  rank: number;
  kind: WantKind;
  songKey: SongKey;
  mediaId: MediaId;
  reason: WantReason;
}

/** The dedup/residency key the policy and the driver must agree on. */
export const wantKey = (songKey: SongKey, kind: WantKind): string => `${songKey}::${kind}`;

/**
 * Song -> PrefetchSong, the ONE place the collection screen's raw rows are
 * narrowed. Five fields, no allocation beyond the object itself: this runs
 * over a whole playlist on every identity change, so it stays a plain map.
 *
 * The compressed-first ladder mirrors `downloadSong`'s bundle rules exactly,
 * because a predictive fetch that pulled a DIFFERENT media id than the real
 * download would be pure waste - the promotion in section 1.2 only works
 * when both tiers address the same bytes.
 */
export const toPrefetchSong = (song: Song, songKey: SongKey): PrefetchSong => ({
  songKey,
  audioMediaId: song.compressed_audio_media_id || song.audio_media_id || null,
  artworkMediaId: song.compressed_artwork_media_id || song.artwork_media_id || null,
  jam: song.jam_song === true || typeof song.audio_url === "string",
  song,
});
