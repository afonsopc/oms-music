/**
 * The versioned defaults of the download settings (owner report 2026-08-16,
 * point 11: "Incluir faixas separadas" must arrive ON, "Antecipar só por
 * WiFi" OFF, "Descarregar à frente" ON).
 *
 * Two of those three were ALREADY correct in DEFAULTS when the report was
 * written, which is the whole reason this file exists: `updateDownloadSettings`
 * persists the entire object, so the first flip of any toggle - including the
 * ones the library view and the player cog write on the user's behalf -
 * freezes every key into kv, and a later default change can never reach that
 * install. Correcting a default is therefore only half a fix; the other half
 * is the one-shot re-assert, and it is what this file guards.
 *
 * kv is mocked because expo-sqlite/kv-store drags react-native into the
 * import graph and bun cannot parse its Flow types. The module reads kv at
 * IMPORT time, so every case seeds the store before its dynamic import.
 */
import { describe, expect, it, mock } from "bun:test";

const store = new Map<string, string>();

mock.module("@/db/kv", () => ({
  kvGet: (key: string) => store.get(key) ?? null,
  kvSet: (key: string, value: string) => {
    store.set(key, value);
  },
  kvRemove: (key: string) => {
    store.delete(key);
  },
  kvGetJson: (key: string) => {
    const raw = store.get(key);
    if (raw == null) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },
  kvSetJson: (key: string, value: unknown) => {
    store.set(key, JSON.stringify(value));
  },
}));

const KV_KEY = "oms-music.download-settings";
const VERSION_KEY = "oms-music.download-settings.version";

describe("download settings defaults", () => {
  it("re-asserts the owner's three values over a frozen pre-version object", async () => {
    // Exactly what an install that had ever touched a toggle carried: every
    // key written out, at the values that shipped before 2026-08-16.
    store.clear();
    store.set(
      KV_KEY,
      JSON.stringify({
        wifiOnly: true, // a deliberate choice, no report asked to change it
        includeStems: false,
        showOnlyDownloaded: true, // written by the library view, not a default
        predictiveEnabled: false,
        predictiveWifiOnly: true,
        evictableBudgetBytes: 1024,
      }),
    );

    const { getDownloadSettings } = await import("../settings");
    const s = getDownloadSettings();

    expect(s.includeStems).toBe(true);
    expect(s.predictiveEnabled).toBe(true);
    expect(s.predictiveWifiOnly).toBe(false);

    // Untouched: the migration re-asserts three keys, it does not reset the
    // object. Throwing away a deliberate wifiOnly or a chosen budget would be
    // a worse bug than the one it fixes.
    expect(s.wifiOnly).toBe(true);
    expect(s.showOnlyDownloaded).toBe(true);
    expect(s.evictableBudgetBytes).toBe(1024);

    // Stamped, so the re-assert happens once and the user's later choices stick.
    expect(JSON.parse(store.get(VERSION_KEY)!)).toBe(2);
    expect(JSON.parse(store.get(KV_KEY)!).predictiveWifiOnly).toBe(false);
  });
});
