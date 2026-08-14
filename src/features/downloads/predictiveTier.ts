/**
 * The evictable tier's numbers, resolved across the three platforms.
 *
 * `DownloadsSurface` is the platform-neutral face of the downloads subsystem,
 * and the predictive controls are declared OPTIONAL on it so a platform that
 * has not wired them yet still compiles. That leaves exactly one question for
 * the screens: what to render when a platform cannot answer. This module is
 * the single place that decides, so neither screen has to.
 *
 * The rule: a number we cannot compute is `null` and is NOT DRAWN. Rendering
 * "0 B de 0 B" for a desktop cache that is actually holding two gigabytes
 * would be worse than saying nothing, and a purge button that quietly frees
 * nothing is worse than a disabled one.
 *
 * Native falls back to the manager directly because on native the surface IS
 * the manager - the fallback is the same code path, not a second one - and
 * because `downloads/manager` is already in every bundle (register.ts imports
 * it unconditionally and early-returns on web).
 */
import { Platform } from "react-native";
import {
  evictableBudgetBytes,
  predictiveWaste as nativePredictiveWaste,
  purgeEvictable as nativePurgeEvictable,
} from "@/downloads/manager";
import { getDownloadsSurface, type UsageTotals } from "@/downloads/surface";

export interface PredictiveWaste {
  written: number;
  evictedUnplayed: number;
  ratio: number;
}

export interface PredictiveTierReads {
  /** What the tier is holding right now. Always answerable (SQL SUM). */
  usage: UsageTotals;
  /** The ceiling it is swept down to, or null when this platform cannot say. */
  budget: number | null;
  /** Session waste, or null when this platform does not measure it. */
  waste: PredictiveWaste | null;
  /** Null when nothing here can actually free bytes: the button stays off. */
  purge: (() => Promise<number>) | null;
}

const isNative = Platform.OS !== "web";

export const readPredictiveTier = (): PredictiveTierReads => {
  const surface = getDownloadsSurface();

  const budget = surface.evictableBudget?.() ?? (isNative ? evictableBudgetBytes() : null);

  const waste = surface.predictiveWaste?.() ?? (isNative ? nativePredictiveWaste() : null);

  const surfacePurge = surface.purgeEvictable;
  const purge: (() => Promise<number>) | null = surfacePurge
    ? async () => surfacePurge.call(surface)
    : isNative
      ? async () => nativePurgeEvictable()
      : null;

  return {
    usage: surface.available() ? surface.evictableUsage() : { bytes: 0, files: 0 },
    budget: budget != null && budget > 0 ? budget : null,
    waste,
    purge,
  };
};
