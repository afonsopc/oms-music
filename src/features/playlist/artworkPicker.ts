/**
 * Playlist artwork picking (FR-51).
 *
 * expo-file-system (SDK 57) ships the system file picker, so no extra
 * dependency is needed to CHOOSE an image. What is missing is a way to
 * TRANSFORM one: neither expo-image nor expo-file-system can crop to a
 * square or re-encode to JPEG, and expo-image-manipulator is not installed.
 * v1 therefore uploads the picked file as it is and refuses anything over
 * the ~2 MB the web's compression targeted, instead of silently pushing a
 * 12 MP camera roll shot at the storage backend.
 */
import { File } from "expo-file-system";

/** Same ceiling the web's crop dialog compressed towards. */
export const MAX_ARTWORK_BYTES = 2 * 1024 * 1024;
export const MAX_ARTWORK_MB = 2;

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
};
