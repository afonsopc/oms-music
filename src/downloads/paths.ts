/**
 * Download file locations (DESIGN 9.1): files live under a per-user
 * directory `<documents>/oms-downloads/<userId>/` with REAL extensions
 * (m4a/mp3/flac/jpg...), one file per (song_key, kind). Storage accounting
 * is a directory walk (FR-85/92).
 *
 * Backup exclusion (FR-84): expo-file-system SDK 57 still exposes no
 * cloud-backup flag, so the local `oms-native` module does it. iOS sets
 * `isExcludedFromBackup` on the root and on the per-user directory right after
 * creation (below); Android needs no runtime call - oms-native's config plugin
 * excludes `<files>/oms-downloads/` through `android:fullBackupContent` and
 * `android:dataExtractionRules`.
 */
import { Directory, File, Paths } from "expo-file-system";
import { excludeFromBackup } from "../../modules/oms-native";
import type { SongKey } from "@/domain/ids";
import type { DownloadKind } from "@/domain/downloads";
import type { Song } from "@/domain/song";

/** Must stay in sync with DOWNLOADS_DIR in modules/oms-native/app.plugin.js. */
const ROOT_DIR_NAME = "oms-downloads";

/** Paths already flagged this launch (the flag itself is persistent). */
const excluded = new Set<string>();

export const userDownloadDirectory = (userId: string): Directory =>
  new Directory(Paths.document, ROOT_DIR_NAME, userId);

/** Creates the per-user directory (idempotent, with intermediates). */
export const ensureUserDownloadDirectory = (userId: string): Directory => {
  const dir = userDownloadDirectory(userId);
  try {
    dir.create({ intermediates: true, idempotent: true });
  } catch {
    // Existing directory or transient FS error; downloads will surface it.
  }
  // FR-84: keep downloads out of iCloud / iTunes backups. The root carries the
  // flag for everything beneath it; the per-user directory is flagged too so a
  // pre-existing root that missed the call still covers this user. Never
  // throws, and a false return only means the files stay backed up.
  excludeOnce(new Directory(Paths.document, ROOT_DIR_NAME).uri);
  excludeOnce(dir.uri);
  return dir;
};

const excludeOnce = (uri: string): void => {
  if (excluded.has(uri)) return;
  // Only memoize a flag that actually stuck: a directory that did not exist yet
  // returns false, and remembering that would disable FR-84 for the launch.
  if (excludeFromBackup(uri)) excluded.add(uri);
};

/** Maps a Song's codec metadata onto a usable file extension. */
const codecExtension = (codec: string | null): string => {
  const normalized = (codec ?? "").toLowerCase();
  if (normalized.includes("flac")) return "flac";
  if (normalized.includes("alac")) return "m4a";
  if (normalized.includes("aac")) return "m4a";
  if (normalized.includes("mp3") || normalized.includes("mpeg")) return "mp3";
  if (normalized.includes("opus")) return "opus";
  if (normalized.includes("vorbis") || normalized.includes("ogg")) return "ogg";
  if (normalized.includes("wav") || normalized.includes("pcm")) return "wav";
  return "bin";
};

/**
 * Real extension per kind: the compressed mix is always the server's AAC/M4A
 * transcode; the original master follows the song codec; stems are the
 * separation pipeline's mp3s; artwork is jpeg.
 */
export const extensionForKind = (
  kind: DownloadKind,
  song: Song,
  usesCompressedNode: boolean,
): string => {
  switch (kind) {
    case "mixed":
      return usesCompressedNode ? "m4a" : codecExtension(song.audio_codec);
    case "mixed_original":
      return codecExtension(song.audio_codec);
    case "vocal":
    case "instrumental":
      return "mp3";
    case "artwork":
      return "jpg";
  }
};

export const filenameFor = (
  songKey: SongKey,
  kind: DownloadKind,
  song: Song,
  usesCompressedNode: boolean,
): string => `${songKey}_${kind}.${extensionForKind(kind, song, usesCompressedNode)}`;

/** Recursive byte walk of the per-user directory (FR-85/92 accounting). */
export const walkDirectoryBytes = (dir: Directory): { bytes: number; files: number } => {
  let bytes = 0;
  let files = 0;
  const visit = (d: Directory): void => {
    let entries: (Directory | File)[];
    try {
      entries = d.list();
    } catch {
      return; // Directory missing or unreadable.
    }
    for (const entry of entries) {
      if (entry instanceof Directory) {
        visit(entry);
      } else {
        files += 1;
        bytes += entry.size ?? 0;
      }
    }
  };
  if (dir.exists) visit(dir);
  return { bytes, files };
};
