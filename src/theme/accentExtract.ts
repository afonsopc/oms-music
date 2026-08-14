/**
 * Native average-color extraction (FR-66, DESIGN 8.8): expo-image's [1,1]
 * blurhash has a DC component that IS the sRGB average of the image, decoded
 * by accentMath's blurhashAverageHex. The web build resolves
 * accentExtract.web.ts instead - on web generateBlurhashAsync always throws,
 * which used to silently collapse every gradient (Now Playing backdrop,
 * collection Heros, artist scrims) into the fixed fallback.
 *
 * accent.ts owns the caching and staleness rules; this module only answers
 * "what color is this image".
 */
import { Image } from "expo-image";
import { blurhashAverageHex } from "./accentMath";

export const extractAverageHex = async (imageUri: string): Promise<string> => {
  const blurhash = await Image.generateBlurhashAsync(imageUri, [1, 1]);
  if (!blurhash) throw new Error("No blurhash");
  return blurhashAverageHex(blurhash);
};
