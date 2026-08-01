/**
 * i18n runtime (DESIGN.md 12). Exactly three locales: en (default), pt
 * (EUROPEAN Portuguese), lv. Music keys live under
 * components.music.<Component>.<key>; native-only namespaces live under
 * native.*. New keys land in ALL THREE catalogs in the same commit; a bun
 * test enforces key-tree equality.
 */
import { useSyncExternalStore } from "react";
import en from "./catalogs/en.json";
import pt from "./catalogs/pt.json";
import lv from "./catalogs/lv.json";
import { formatIcu, type IcuParams } from "./icu";
import { kvGet, kvSet } from "@/db/kv";

export type Locale = "en" | "pt" | "lv";
export const LOCALES: readonly Locale[] = ["en", "pt", "lv"];

/** Date labels render in the Lisbon timezone, matching the web. */
export const TIME_ZONE = "Europe/Lisbon";

const LOCALE_KV_KEY = "oms-music.locale";

type Catalog = Record<string, unknown>;
const catalogs: Record<Locale, Catalog> = {
  en: en as Catalog,
  pt: pt as Catalog,
  lv: lv as Catalog,
};

const isLocale = (value: unknown): value is Locale =>
  value === "en" || value === "pt" || value === "lv";

const detectDeviceLocale = (): Locale => {
  try {
    const resolved = new Intl.DateTimeFormat().resolvedOptions().locale ?? "";
    const language = resolved.toLowerCase().split(/[-_]/)[0];
    if (isLocale(language)) return language;
  } catch {
    // Fall through to the default.
  }
  return "en";
};

let currentLocale: Locale = (() => {
  const stored = kvGet(LOCALE_KV_KEY);
  return isLocale(stored) ? stored : detectDeviceLocale();
})();

const listeners = new Set<() => void>();

export const getLocale = (): Locale => currentLocale;

export const setLocale = (locale: Locale): void => {
  if (locale === currentLocale) return;
  currentLocale = locale;
  kvSet(LOCALE_KV_KEY, locale);
  for (const cb of listeners) cb();
};

export const subscribeLocale = (cb: () => void): (() => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

const lookup = (catalog: Catalog, key: string): string | null => {
  let node: unknown = catalog;
  for (const part of key.split(".")) {
    if (node && typeof node === "object" && part in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[part];
    } else {
      return null;
    }
  }
  return typeof node === "string" ? node : null;
};

/** Translates a full key path ("components.music.Sidebar.libraryTitle"). */
export const t = (key: string, params?: IcuParams): string => {
  const message = lookup(catalogs[currentLocale], key) ?? lookup(catalogs.en, key);
  if (message == null) return key;
  return params ? formatIcu(message, currentLocale, params) : formatIcu(message, currentLocale);
};

/**
 * Hook variant: re-renders on locale change. Returns a `t` bound to the
 * current locale (stable identity per locale so memoized children refresh).
 */
const boundTs = new Map<Locale, (key: string, params?: IcuParams) => string>();
const boundT = (locale: Locale): ((key: string, params?: IcuParams) => string) => {
  let fn = boundTs.get(locale);
  if (!fn) {
    fn = (key, params) => {
      const message = lookup(catalogs[locale], key) ?? lookup(catalogs.en, key);
      if (message == null) return key;
      return formatIcu(message, locale, params ?? {});
    };
    boundTs.set(locale, fn);
  }
  return fn;
};

export const useLocale = (): Locale =>
  useSyncExternalStore(subscribeLocale, getLocale, getLocale);

export const useT = (): ((key: string, params?: IcuParams) => string) => {
  const locale = useLocale();
  return boundT(locale);
};
