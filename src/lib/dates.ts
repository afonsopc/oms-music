/**
 * Date label helpers. Labels render in the Lisbon timezone with the active
 * locale (DESIGN 12); failures degrade to the ISO date part.
 */
import { TIME_ZONE, type Locale } from "@/i18n";

export const formatDate = (iso: string, locale: Locale): string => {
  try {
    return new Date(iso).toLocaleDateString(locale, { timeZone: TIME_ZONE });
  } catch {
    return iso.slice(0, 10);
  }
};

export const formatDateTime = (iso: string, locale: Locale): string => {
  try {
    return new Date(iso).toLocaleString(locale, { timeZone: TIME_ZONE });
  } catch {
    return iso.replace("T", " ").slice(0, 16);
  }
};

/** Whole minutes elapsed since the ISO timestamp (>= 0). */
export const minutesSince = (iso: string, now: number = Date.now()): number =>
  Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));

/** Elapsed m:ss counter (separation timers etc.). */
export const formatElapsed = (startedAtIso: string, now: number = Date.now()): string => {
  const total = Math.max(0, Math.floor((now - new Date(startedAtIso).getTime()) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
};
