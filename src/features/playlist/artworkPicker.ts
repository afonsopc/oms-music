/**
 * Playlist artwork picking (FR-51).
 *
 * expo-file-system (SDK 57) ships the system file picker, so choosing an image
 * needs no extra dependency. Transforming one goes through
 * `@/lib/artworkTranscode` (expo-image-manipulator): the pick is center-cropped
 * to a square and re-encoded to JPEG under the ~2 MB the web's crop dialog
 * compressed towards, instead of a 12 MP camera roll shot being pushed at the
 * storage backend as it is. The backend names the node `.jpg` either way
 * (SongServices::PlaylistArtworkUploader), so JPEG is the right output.
 */
import { File } from "expo-file-system";
import {
  ARTWORK_FILE_NAME,
  ARTWORK_MAX_BYTES,
  ARTWORK_MAX_MB,
  transcodeToJpeg,
} from "@/lib/artworkTranscode";

/** Re-exported under the names the screen already imports. */
export const MAX_ARTWORK_BYTES = ARTWORK_MAX_BYTES;
export const MAX_ARTWORK_MB = ARTWORK_MAX_MB;

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".gif"];
const FALLBACK_TYPE = "image/jpeg";

export interface PickedArtwork {
  uri: string;
  name: string;
  type: string;
  size: number;
}

export type ArtworkPickOutcome =
  | { kind: "canceled" }
  | { kind: "notAnImage" }
  | { kind: "tooLarge"; size: number }
  | { kind: "picked"; artwork: PickedArtwork };

/** Mime first, extension as the fallback (content:// mimes are often ""). */
export const isImageLike = (name: string, mimeType: string): boolean => {
  if (mimeType.startsWith("image/")) return true;
  const lower = name.toLowerCase();
  return IMAGE_EXTENSIONS.some((extension) => lower.endsWith(extension));
};

export const pickPlaylistArtwork = async (): Promise<ArtworkPickOutcome> => {
  const picked = await File.pickFileAsync({ mimeTypes: ["image/*"] });
  if (picked.canceled || !picked.result) return { kind: "canceled" };

  const file = picked.result;
  if (!isImageLike(file.name, file.type)) return { kind: "notAnImage" };

  try {
    const jpeg = await transcodeToJpeg(file.uri, { square: true, name: ARTWORK_FILE_NAME });
    // Only reachable if even a 320px JPEG at the bottom of the quality ladder
    // stayed over budget, which no real photograph does.
    if (!jpeg.withinBudget) return { kind: "tooLarge", size: jpeg.size };
    return {
      kind: "picked",
      artwork: { uri: jpeg.uri, name: jpeg.name, type: jpeg.type, size: jpeg.size },
    };
  } catch {
    // The native decoder could not read the file (exotic format). Send the
    // picked bytes as they are, but keep the ceiling so the fallback cannot
    // turn into an unbounded upload.
    if (file.size > MAX_ARTWORK_BYTES) return { kind: "tooLarge", size: file.size };
    return {
      kind: "picked",
      artwork: {
        uri: file.uri,
        name: file.name,
        type: file.type && file.type.length > 0 ? file.type : FALLBACK_TYPE,
        size: file.size,
      },
    };
  }
};
