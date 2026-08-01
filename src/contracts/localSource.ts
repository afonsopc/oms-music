/**
 * Local file seam (DESIGN.md 13.1). The player's source ladder asks this
 * index for downloaded files; WP8 registers the real index at boot. The
 * default returns null for everything, so everything streams.
 */
import type { SongKey } from "@/domain/ids";
import type { DownloadKind } from "@/domain/downloads";

export interface LocalFileIndex {
  /** Returns a file:// uri for a completed download, or null. */
  get(songKey: SongKey, kind: DownloadKind): string | null;
}

const inertIndex: LocalFileIndex = {
  get: () => null,
};

let current: LocalFileIndex = inertIndex;

/** WP8 (downloads/register.ts) installs the real index here. */
export const setLocalFileIndex = (index: LocalFileIndex): void => {
  current = index;
};

export const getLocalFileIndex = (): LocalFileIndex => current;
