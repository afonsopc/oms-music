/**
 * Picked image -> square JPEG under the backend's ceiling (FR-51).
 *
 * expo-image-manipulator (SDK 57) exposes the contextual, object-oriented API:
 * `ImageManipulator.manipulate(source)` returns a chainable context whose
 * `renderAsync()` resolves to an `ImageRef` carrying the real pixel dimensions,
 * and `ImageRef.saveAsync({ format, compress })` writes a file into the cache.
 * The deprecated `manipulateAsync` is not used.
 *
 * The web crops interactively and picks a single compression ratio
 * (frontend/components/music/ChangePlaylistArtwork.tsx). There is no crop
 * canvas on native, so this centers the crop on the shorter side and walks a
 * compress loop instead of guessing one ratio: progressively smaller edges,
 * each tried down a quality ladder, stopping at the first encode that fits the
 * budget. Rejected encodes are deleted so the cache does not collect the
 * discarded attempts.
 */
import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat, type ImageRef } from "expo-image-manipulator";
import { centeredSquareRect, encodePlan, scaleToFit } from "./imageTransform";

/** Same ceiling the web's crop dialog compressed towards. */
export const ARTWORK_MAX_BYTES = 2 * 1024 * 1024;
export const ARTWORK_MAX_MB = 2;

/** Square artwork never needs more than this; the tiles top out far below it. */
export const ARTWORK_MAX_EDGE = 1200;

/** Artist banners are wide, so they get more room along the long side. */
export const BANNER_MAX_EDGE = 1600;

export const JPEG_MIME = "image/jpeg";

/** What the web named its cropped upload. */
export const ARTWORK_FILE_NAME = "artwork.jpg";

export interface TranscodeOptions {
  /** Center-crop to the shorter side first. Default true; banners pass false. */
  square?: boolean;
  /** Byte budget the compress loop aims for. Default {@link ARTWORK_MAX_BYTES}. */
  maxBytes?: number;
  /** Longest side of the first encode attempt. Default {@link ARTWORK_MAX_EDGE}. */
  maxEdge?: number;
  /** Multipart filename. Default {@link ARTWORK_FILE_NAME}. */
  name?: string;
}

export interface TranscodedImage {
  uri: string;
  name: string;
  type: string;
  size: number;
  width: number;
  height: number;
  /**
   * False when even the bottom of the ladder stayed over `maxBytes`. The
   * returned file is then the smallest encode produced, and the caller decides
   * whether to send it or refuse.
   */
  withinBudget: boolean;
}

interface Candidate {
  uri: string;
  size: number;
  width: number;
  height: number;
}

/** Best-effort cache cleanup; a failed delete must not fail the upload. */
const discard = (uri: string): void => {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Cache files are transient anyway.
  }
};

const sizeOf = (uri: string): number => {
  try {
    return new File(uri).size;
  } catch {
    // An unreadable encode cannot be compared, so treat it as oversized and
    // let the loop keep going.
    return Number.MAX_SAFE_INTEGER;
  }
};

/**
 * Decodes `uri`, optionally center-crops it to a square, and re-encodes to JPEG
 * until the file fits `maxBytes`. Throws only when the image cannot be decoded
 * or encoded at all.
 */
export const transcodeToJpeg = async (
  uri: string,
  options: TranscodeOptions = {},
): Promise<TranscodedImage> => {
  const square = options.square ?? true;
  const maxBytes = options.maxBytes ?? ARTWORK_MAX_BYTES;
  const maxEdge = options.maxEdge ?? ARTWORK_MAX_EDGE;
  const name = options.name ?? ARTWORK_FILE_NAME;

  const loaded = await ImageManipulator.manipulate(uri).renderAsync();

  let base: ImageRef = loaded;
  if (square) {
    const rect = centeredSquareRect(loaded.width, loaded.height);
    if (rect) base = await ImageManipulator.manipulate(loaded).crop(rect).renderAsync();
  }

  let best: Candidate | null = null;
  // A pick already smaller than the first stage's edge would otherwise be
  // re-encoded identically once per stage, so stages that cannot shrink it any
  // further than the previous one are skipped.
  let lastLongestSide: number | null = null;

  for (const stage of encodePlan(maxEdge)) {
    const fitted = scaleToFit(base.width, base.height, stage.edge);
    const longestSide = fitted
      ? Math.max(fitted.width, fitted.height)
      : Math.max(base.width, base.height);
    if (lastLongestSide !== null && longestSide === lastLongestSide) continue;
    lastLongestSide = longestSide;

    const staged = fitted
      ? await ImageManipulator.manipulate(base).resize(fitted).renderAsync()
      : base;

    for (const quality of stage.qualities) {
      const saved = await staged.saveAsync({ format: SaveFormat.JPEG, compress: quality });
      const candidate: Candidate = {
        uri: saved.uri,
        size: sizeOf(saved.uri),
        width: saved.width,
        height: saved.height,
      };

      if (candidate.size <= maxBytes) {
        if (best) discard(best.uri);
        return { ...candidate, name, type: JPEG_MIME, withinBudget: true };
      }

      if (!best || candidate.size < best.size) {
        if (best) discard(best.uri);
        best = candidate;
      } else {
        discard(candidate.uri);
      }
    }
    // Nothing at this stage fit; the next one has a strictly smaller edge, so
    // the loop keeps making progress until the plan runs out.
  }

  if (!best) throw new Error("The image could not be encoded");
  return { ...best, name, type: JPEG_MIME, withinBudget: false };
};
