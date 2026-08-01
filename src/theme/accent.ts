/**
 * Artwork accent extraction (FR-66, DESIGN 8.8). BOTH theme variants are
 * computed per extraction and cached (LRU 100) so a theme flip restyles
 * gradients without re-downloading bytes. Guarded against stale async
 * results: the caller passes a key (song id) and gets back the entry only
 * when it is still the newest request for that key.
 *
 * Average color comes from expo-image's [1,1] blurhash: its DC component is
 * exactly the sRGB average of the image (decoded in accentMath.ts).
 */
import { Image } from "expo-image";
import {
  type AccentVariants,
  blurhashAverageHex,
  heroAccentVariants,
  songAccentVariants,
} from "./accentMath";
import { ACCENT_FALLBACK, HERO_FALLBACK } from "./tokens";

export type AccentKind = "song" | "hero";

interface CacheEntry {
  variants: AccentVariants;
}

const LRU_LIMIT = 100;

const caches: Record<AccentKind, Map<string, CacheEntry>> = {
  song: new Map(),
  hero: new Map(),
};

/** Latest request generation per (kind, key): stale extractions are dropped. */
const generations: Record<AccentKind, Map<string, number>> = {
  song: new Map(),
  hero: new Map(),
};

const fallbackVariants = (kind: AccentKind): AccentVariants =>
  kind === "song"
    ? { light: ACCENT_FALLBACK, dark: ACCENT_FALLBACK }
    : { light: HERO_FALLBACK, dark: HERO_FALLBACK };

const lruTouch = (cache: Map<string, CacheEntry>, key: string, entry: CacheEntry): void => {
  cache.delete(key);
  cache.set(key, entry);
  if (cache.size > LRU_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
};

/** Synchronous cache read (render path). */
export const getCachedAccent = (kind: AccentKind, key: string): AccentVariants | null =>
  caches[kind].get(key)?.variants ?? null;

const extractAverageHex = async (imageUri: string): Promise<string> => {
  const blurhash = await Image.generateBlurhashAsync(imageUri, [1, 1]);
  if (!blurhash) throw new Error("No blurhash");
  return blurhashAverageHex(blurhash);
};

/**
 * Resolves both variants for the key, from cache or by extraction. On any
 * failure the fixed fallback pair is returned (and NOT cached, so a later
 * retry can succeed). Stale async guard: only the newest in-flight request
 * per key may write the cache.
 */
export const resolveAccent = async (
  kind: AccentKind,
  key: string,
  imageUri: string | null,
): Promise<AccentVariants> => {
  const cached = caches[kind].get(key);
  if (cached) {
    lruTouch(caches[kind], key, cached);
    return cached.variants;
  }
  if (!imageUri) return fallbackVariants(kind);

  const generation = (generations[kind].get(key) ?? 0) + 1;
  generations[kind].set(key, generation);

  try {
    const average = await extractAverageHex(imageUri);
    const variants = kind === "song" ? songAccentVariants(average) : heroAccentVariants(average);
    if (generations[kind].get(key) === generation) {
      lruTouch(caches[kind], key, { variants });
    }
    return variants;
  } catch {
    return fallbackVariants(kind);
  }
};

/** Test/logout hygiene. */
export const clearAccentCaches = (): void => {
  caches.song.clear();
  caches.hero.clear();
  generations.song.clear();
  generations.hero.clear();
};
