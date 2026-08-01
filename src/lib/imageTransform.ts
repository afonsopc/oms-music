/**
 * Pure geometry and encode-plan maths behind the artwork pipeline (FR-51 and
 * the settings / import image uploads).
 *
 * Deliberately free of native imports so the arithmetic is unit-testable under
 * bun: the module that actually drives expo-image-manipulator is
 * `artworkTranscode.ts`, which imports everything here.
 */

export interface CropRect {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

export interface PixelSize {
  width: number;
  height: number;
}

/** One resize level plus the JPEG qualities to try at it, best first. */
export interface EncodeStage {
  edge: number;
  qualities: number[];
}

/**
 * Quality ladder walked at each resize level. The top of the ladder already
 * lands a 1200px square well under 2 MiB for anything but pathological noise,
 * so the lower rungs are the safety net rather than the common path.
 */
export const JPEG_QUALITIES = [0.85, 0.65, 0.45] as const;

/** Resize levels, as divisors of the caller's `maxEdge`. */
const EDGE_DIVISORS = [1, 1.5, 2.5] as const;

/** Never shrink past this: below it the artwork stops being usable. */
export const MIN_ENCODE_EDGE = 320;

/**
 * Centered crop to the shorter side. Returns null when there is nothing to do
 * (already square, or the dimensions are unusable), so the caller can skip a
 * pointless native round trip.
 */
export const centeredSquareRect = (width: number, height: number): CropRect | null => {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  const w = Math.floor(width);
  const h = Math.floor(height);
  if (w <= 0 || h <= 0 || w === h) return null;
  const edge = Math.min(w, h);
  return {
    originX: Math.floor((w - edge) / 2),
    originY: Math.floor((h - edge) / 2),
    width: edge,
    height: edge,
  };
};

/**
 * Ratio-preserving fit inside a `maxEdge` box. Returns null when the image
 * already fits, so upscaling never happens.
 */
export const scaleToFit = (
  width: number,
  height: number,
  maxEdge: number,
): PixelSize | null => {
  if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(maxEdge)) {
    return null;
  }
  const w = Math.floor(width);
  const h = Math.floor(height);
  if (w <= 0 || h <= 0 || maxEdge <= 0) return null;
  const longest = Math.max(w, h);
  if (longest <= maxEdge) return null;
  const ratio = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(w * ratio)),
    height: Math.max(1, Math.round(h * ratio)),
  };
};

/**
 * Ordered attempts for the compress loop: progressively smaller edges, each
 * walked down the quality ladder. Duplicate edges are collapsed so a small
 * `maxEdge` does not re-encode the same size three times.
 */
export const encodePlan = (maxEdge: number): EncodeStage[] => {
  const ceiling = Number.isFinite(maxEdge) && maxEdge > 0 ? Math.floor(maxEdge) : MIN_ENCODE_EDGE;
  const stages: EncodeStage[] = [];
  for (const divisor of EDGE_DIVISORS) {
    const edge = Math.max(MIN_ENCODE_EDGE, Math.round(ceiling / divisor));
    if (stages.some((stage) => stage.edge === edge)) continue;
    stages.push({ edge, qualities: [...JPEG_QUALITIES] });
  }
  return stages;
};

/**
 * Renames a picked file to the `.jpg` it becomes after re-encoding. Directory
 * separators are dropped (Android hands back names from content:// providers)
 * and a name that is nothing but an extension falls back.
 */
export const jpegName = (original: string, fallback = "artwork.jpg"): string => {
  const tail = original.split(/[\\/]/).pop() ?? "";
  const stem = tail.trim().replace(/\.[^.]*$/, "").trim();
  if (!stem) return fallback;
  return `${stem}.jpg`;
};
