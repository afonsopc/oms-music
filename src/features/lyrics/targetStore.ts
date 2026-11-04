/**
 * Persisted lyrics translation target (FR-79): one target per device,
 * defaulting to the UI locale. Mirrors the web's localStorage key
 * "music-lyrics-target". Turning translation OFF keeps the stored target -
 * only choosing a language writes here; the on/off flag is session state.
 */
import { kvGet, kvSet } from "@/db/kv";
import type { LyricsTranslationTarget } from "@/domain/lyrics";
import { getLocale } from "@/i18n";
import { isTranslationTarget } from "@/lyrics/translation";

const TARGET_KV_KEY = "music-lyrics-target";

export const getStoredTranslationTarget = (): LyricsTranslationTarget | null => {
  const stored = kvGet(TARGET_KV_KEY);
  return isTranslationTarget(stored) ? stored : null;
};

export const storeTranslationTarget = (target: LyricsTranslationTarget): void => {
  kvSet(TARGET_KV_KEY, target);
};

/**
 * Stored target, else the UI locale (every app locale is a valid target).
 */
export const initialTranslationTarget = (): LyricsTranslationTarget =>
  getStoredTranslationTarget() ?? getLocale();

const TRANSLATE_ON_KV_KEY = "music-lyrics-translate-on";

/**
 * Se a tradução ficou ligada da última vez (2026-11-04): o pré-carregamento
 * da fila só traduz de antemão para quem lê as letras traduzidas.
 */
export const translationWasOn = (): boolean => kvGet(TRANSLATE_ON_KV_KEY) === "1";

export const storeTranslationOn = (on: boolean): void => {
  kvSet(TRANSLATE_ON_KV_KEY, on ? "1" : "0");
};
