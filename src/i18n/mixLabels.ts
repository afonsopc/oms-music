/**
 * Mix titles/descriptions render from title_key/description_key + params
 * through the catalog (components.music.mixLabels.*) - NEVER the English
 * fallback strings in the payload (FR-19, FR-121). Radios render their
 * pre-baked Portuguese strings as-is.
 */
import type { MixSummary } from "@/domain/mixes";
import type { IcuParams } from "./icu";

type Translate = (key: string, params?: IcuParams) => string;

export const mixTitle = (mix: MixSummary, t: Translate): string =>
  mix.title_key
    ? t(`components.music.mixLabels.title.${mix.title_key}`, mix.title_params ?? {})
    : mix.title;

export const mixDescription = (mix: MixSummary, t: Translate): string =>
  mix.description_key
    ? t(
        `components.music.mixLabels.description.${mix.description_key}`,
        mix.description_params ?? {},
      )
    : mix.description;

/**
 * The short word stamped across the tile artwork: the artist for an artist
 * mix, the decade for a time capsule, else the (localized) title.
 */
export const mixStampText = (mix: MixSummary, title: string): string => {
  if ((mix.kind === "top_artist" || mix.kind === "this_is") && mix.artist?.name) {
    return mix.artist.name;
  }
  if (mix.kind === "time_capsule" && mix.seed != null) return `${mix.seed}s`;
  if (mix.kind === "year_mix" && mix.seed != null) return `${mix.seed}`;
  return title;
};

/** Stamp text size stepped by length (SPEC design language). */
export const mixStampFontSize = (text: string): number => {
  if (text.length <= 8) return 30;
  if (text.length <= 14) return 24;
  if (text.length <= 22) return 20;
  return 16;
};
