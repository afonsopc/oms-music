/**
 * The desktop `LocalFileIndex` (contracts/localSource): the seam the player's
 * source ladder and ui/ArtworkImage already ask, answered from the Rust cache
 * instead of expo-file-system.
 *
 * Both reads are SYNCHRONOUS, which is the whole reason this module holds a
 * warm map instead of calling into Rust. `resolveSources` runs inside the
 * engine's load path and `resolveArtwork` runs inside a render; neither can
 * await anything, and an `invoke` per row would be an IPC round trip per
 * artwork tile.
 *
 * The URLs are built here rather than by a `cache_url` command for the same
 * reason. Only the ORIGIN comes from Rust (`cache_open`), because its form is
 * platform-dependent - `omscache://localhost` on macOS, `http://omscache.localhost`
 * on Windows - and a string built in JS would be wrong on one of them.
 *
 * The map is advisory, exactly like the SQLite index behind it: the protocol
 * handler stats the file on every request and answers 404 when it is gone, and
 * ArtworkImage already falls back to the network on an image error. A stale
 * entry costs one failed request, never a wrong file.
 */
import type { LocalFileIndex } from "@/contracts/localSource";
import type { DownloadKind } from "@/domain/downloads";
import type { MediaId, SongKey } from "@/domain/ids";
import type { CacheStatus, FileEntry } from "./bridge";

const entryKey = (songKey: SongKey, kind: DownloadKind): string => `${songKey}::${kind}`;

let origin = "";
/**
 * Hidratação pendente (contrato LocalFileIndex.ready): entre a instalação
 * síncrona deste índice e o primeiro hydrateLocalIndex há três round-trips
 * de IPC, e nessa janela um `get` responde null com convicção a ficheiros
 * que EXISTEM - era o arranque frio de ~4 s do desktop (handoff 2026-08-17,
 * ponto 4). O engine espera por esta promessa (com tecto) antes de montar a
 * escada. Re-arma no reset (logout) porque a sessão seguinte volta a abrir
 * a cache do zero.
 */
let hydrated = false;
let hydrationResolve: (() => void) | null = null;
let hydrationPromise: Promise<void> | null = null;

const armHydration = (): void => {
  hydrated = false;
  hydrationPromise = new Promise<void>((resolve) => {
    hydrationResolve = resolve;
  });
};
armHydration();

const settleHydration = (): void => {
  hydrated = true;
  hydrationResolve?.();
  hydrationResolve = null;
};

/** "key::kind" for every row Rust reports as done. */
const resident = new Set<string>();
/** "key::kind" -> the media id those bytes came from, for the /m/ lookups. */
const mediaIds = new Map<string, MediaId>();
/** Media ids of DONE artwork rows: the answer set for getArtworkByNodeId. */
const residentArtwork = new Set<MediaId>();

const rebuildArtwork = (): void => {
  residentArtwork.clear();
  for (const key of resident) {
    if (!key.endsWith("::artwork")) continue;
    const mediaId = mediaIds.get(key);
    if (mediaId) residentArtwork.add(mediaId);
  }
};

/** Full replace from `cache_list_files`. Called at open and, debounced, after
 *  transitions - Rust evicts on its own timetable and never announces it, so
 *  a periodic re-read is what keeps the map from claiming bytes that are gone. */
export const hydrateLocalIndex = (nextOrigin: string, files: FileEntry[]): void => {
  origin = nextOrigin;
  resident.clear();
  mediaIds.clear();
  for (const file of files) {
    const key = entryKey(file.songKey as SongKey, file.kind);
    if (file.mediaId) mediaIds.set(key, file.mediaId);
    if (file.status === "done") resident.add(key);
  }
  rebuildArtwork();
  settleHydration();
};

/**
 * Learned at ENQUEUE time, before any bytes exist. Status events carry no
 * media id (they are deliberately four small fields), so without this the
 * artwork lookup would stay blind until the next full re-hydrate - i.e. a
 * freshly downloaded cover would keep hitting the network for a few seconds
 * for no reason.
 */
export const noteWantedMediaId = (
  songKey: SongKey,
  kind: DownloadKind,
  mediaId: MediaId,
): void => {
  if (!mediaId) return;
  mediaIds.set(entryKey(songKey, kind), mediaId);
};

/** Patch from one status transition. */
export const applyLocalIndexStatus = (
  songKey: SongKey,
  kind: DownloadKind,
  status: CacheStatus,
): void => {
  const key = entryKey(songKey, kind);
  if (status === "done") {
    resident.add(key);
    if (kind === "artwork") {
      const mediaId = mediaIds.get(key);
      if (mediaId) residentArtwork.add(mediaId);
    }
    return;
  }
  if (!resident.delete(key)) return;
  if (kind === "artwork") rebuildArtwork();
};

/** Removal of a whole song (the user deleted the download). */
export const forgetSongInLocalIndex = (songKey: SongKey): void => {
  const prefix = `${songKey}::`;
  let touchedArtwork = false;
  for (const key of [...resident]) {
    if (!key.startsWith(prefix)) continue;
    resident.delete(key);
    if (key.endsWith("::artwork")) touchedArtwork = true;
  }
  for (const key of [...mediaIds.keys()]) {
    if (key.startsWith(prefix)) mediaIds.delete(key);
  }
  if (touchedArtwork) rebuildArtwork();
};

export const isLocallyResident = (songKey: SongKey, kind: DownloadKind): boolean =>
  resident.has(entryKey(songKey, kind));

export const localIndexOrigin = (): string => origin;

export const resetLocalIndex = (): void => {
  origin = "";
  resident.clear();
  mediaIds.clear();
  residentArtwork.clear();
  armHydration();
};

export const desktopLocalFileIndex: LocalFileIndex = {
  get: (songKey, kind) =>
    origin && resident.has(entryKey(songKey, kind))
      ? `${origin}/k/${songKey}_${kind}`
      : null,
  /**
   * Artwork quoted as a bare media id (album tiles, artist grids, home rails,
   * the Now Playing metadata builder). Rust resolves `/m/<id>` to the newest
   * done row carrying that id, which is exactly the reverse index the mobile
   * side has to keep by hand.
   */
  getArtworkByNodeId: (mediaId) =>
    origin && residentArtwork.has(mediaId) ? `${origin}/m/${mediaId}` : null,
  ready: () => (hydrated ? null : hydrationPromise),
};
