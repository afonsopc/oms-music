/**
 * File-picking + local-save seam for the settings and import screens (song
 * artwork, artist image/banner, audio import, folder import, FR-126 output).
 *
 * No extra dependency is needed: expo-file-system (SDK 57) ships the system
 * pickers - `File.pickFileAsync` (single/multiple, mime filtered) and
 * `Directory.pickDirectoryAsync`. Everything the screens need funnels through
 * this module so a future swap (expo-image-picker for a nicer photo UI) only
 * touches this file.
 *
 * Picked images go through the same crop/compress pipeline as the playlist
 * artwork (`@/lib/artworkTranscode`) before they leave the device: square for
 * artwork and avatars, ratio-preserving for banners. That also normalizes HEIC
 * camera output, which the backend's image attachers reject outright.
 *
 * Android hands back `content://` URIs; React Native's FormData accepts them
 * as file parts, so the picked `{ uri, name, type }` shape is what every
 * multipart endpoint expects.
 */
import { Directory, File, Paths } from "expo-file-system";
import { BANNER_MAX_EDGE, transcodeToJpeg } from "@/lib/artworkTranscode";
import { jpegName } from "@/lib/imageTransform";

export interface PickedImage {
  uri: string;
  name: string;
  type: string;
}

export interface PickImageOptions {
  /** Center-crop to the shorter side. Default true; banners pass false. */
  square?: boolean;
  /** Longest side of the first encode attempt. */
  maxEdge?: number;
}

export interface PickedAudio {
  uri: string;
  name: string;
  type: string;
  size: number;
  /** Path inside the picked folder ("" for loose files); the folder-tracker key. */
  relativePath: string;
}

export interface PickedFolder {
  /** Folder name, used as the resume-tracker key (FR-100). */
  path: string;
  files: PickedAudio[];
}

export const IMAGE_PICKER_AVAILABLE = true as boolean;
export const AUDIO_PICKER_AVAILABLE = true as boolean;
export const FOLDER_PICKER_AVAILABLE = true as boolean;

const IMAGE_FALLBACK_TYPE = "image/jpeg";
const AUDIO_FALLBACK_TYPE = "audio/mpeg";

/** Server-accepted upload extensions (POST /songs/import). */
const AUDIO_EXTENSIONS = [".mp3", ".wav", ".flac", ".aac", ".ogg", ".m4a", ".opus"];

/** Folder walks stop here; music folders are shallow and iOS access is scoped. */
const MAX_FOLDER_DEPTH = 4;

const hasAudioExtension = (name: string): boolean => {
  const lower = name.toLowerCase();
  return AUDIO_EXTENSIONS.some((extension) => lower.endsWith(extension));
};

/** Mime first, extension as the fallback (content:// mimes are sometimes ""). */
export const isAudioLike = (name: string, mimeType: string): boolean =>
  mimeType.startsWith("audio/") || hasAudioExtension(name);

const toPickedAudio = (file: File, relativePath: string): PickedAudio => ({
  uri: file.uri,
  name: file.name,
  type: file.type && file.type.length > 0 ? file.type : AUDIO_FALLBACK_TYPE,
  size: file.size,
  relativePath,
});

export const pickImage = async (
  options: PickImageOptions = {},
): Promise<PickedImage | null> => {
  const picked = await File.pickFileAsync({ mimeTypes: ["image/*"] });
  if (picked.canceled || !picked.result) return null;
  const file = picked.result;
  try {
    const jpeg = await transcodeToJpeg(file.uri, { ...options, name: jpegName(file.name) });
    return { uri: jpeg.uri, name: jpeg.name, type: jpeg.type };
  } catch {
    // The native decoder could not read it; send the picked bytes as they are
    // rather than losing the upload entirely.
    return {
      uri: file.uri,
      name: file.name,
      type: file.type && file.type.length > 0 ? file.type : IMAGE_FALLBACK_TYPE,
    };
  }
};

/** Artist banners are wide, so they keep their ratio and get a longer edge. */
export const pickBannerImage = (): Promise<PickedImage | null> =>
  pickImage({ square: false, maxEdge: BANNER_MAX_EDGE });

/** Multi-pick, audio only (non-audio picks are dropped, web parity). */
export const pickAudioFiles = async (): Promise<PickedAudio[]> => {
  const picked = await File.pickFileAsync({ multipleFiles: true, mimeTypes: ["audio/*"] });
  if (picked.canceled || !picked.result) return [];
  return picked.result
    .filter((file) => isAudioLike(file.name, file.type))
    .map((file) => toPickedAudio(file, ""));
};

/** Single audio pick (FR-126 metadata modifier input). */
export const pickAudioFile = async (): Promise<PickedAudio | null> => {
  const picked = await File.pickFileAsync({ mimeTypes: ["audio/*"] });
  if (picked.canceled || !picked.result) return null;
  const file = picked.result;
  if (!isAudioLike(file.name, file.type)) return null;
  return toPickedAudio(file, "");
};

const collectAudio = (directory: Directory, prefix: string, depth: number): PickedAudio[] => {
  if (depth > MAX_FOLDER_DEPTH) return [];
  let entries: (Directory | File)[];
  try {
    entries = directory.list();
  } catch {
    return [];
  }
  const found: PickedAudio[] = [];
  for (const entry of entries) {
    if (entry instanceof Directory) {
      found.push(...collectAudio(entry, `${prefix}${entry.name}/`, depth + 1));
    } else if (isAudioLike(entry.name, entry.type)) {
      found.push(toPickedAudio(entry, `${prefix}${entry.name}`));
    }
  }
  return found;
};

/** Folder import (FR-100): the folder name is the resume-tracker key. */
export const pickAudioFolder = async (): Promise<PickedFolder | null> => {
  const directory = await Directory.pickDirectoryAsync();
  if (!directory) return null;
  return { path: directory.name, files: collectAudio(directory, "", 0) };
};

/** Base64 bytes of a picked file (URL-import artwork uploads: artwork_data_b64). */
export const readBase64 = async (uri: string): Promise<string> => new File(uri).base64();

/**
 * Writes a returned binary into the app documents directory (FR-126). The
 * payload arrives base64-encoded because React Native's Blob has no
 * `arrayBuffer()`; FileReader (data URL) is the portable read path. No share
 * sheet ships in v1 (expo-sharing is not a dependency); the screen shows the
 * saved path instead.
 */
export const saveBase64ToDocuments = async (
  base64: string,
  filename: string,
): Promise<string> => {
  const file = new File(Paths.document, filename);
  if (file.exists) file.delete();
  file.create({ intermediates: true, overwrite: true });
  file.write(base64, { encoding: "base64" });
  return file.uri;
};

/** Base64 of a fetched Blob (RN Blob supports FileReader, not arrayBuffer). */
export const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the response"));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
