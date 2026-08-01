/**
 * Listener-settings persistence (FR-65) over expo-sqlite/kv-store. Persists:
 * rate, volume, separation enabled, playback mode ("custom" restores as
 * "original" - the graph-only mode never survives a relaunch), stem volumes,
 * EQ bands (NOT eqEnabled), loop mode. The queue is NEVER persisted locally:
 * the server snapshot is the account queue. Key names mirror the web's
 * localStorage keys. Writes are trailing-debounced 250 ms.
 *
 * This module touches kv (native); the engine receives it via EngineDeps so
 * CI tests inject an in-memory stand-in instead of importing this file.
 */
import { kvGet, kvSet } from "@/db/kv";
import type { LoopMode, PlaybackMode } from "@/domain/playback";
import type { ListenerSettingsPersistence, PersistedListenerSettings } from "./types";

const WRITE_DEBOUNCE_MS = 250;

const KEYS: Record<keyof PersistedListenerSettings, string> = {
  rate: "music-playback-rate",
  volume: "music-volume",
  separationEnabled: "music-separation-enabled",
  playbackMode: "music-playback-mode",
  vocalVolume: "music-vocal-volume",
  instrumentalVolume: "music-instrumental-volume",
  eqLow: "music-equalizer-low",
  eqMid: "music-equalizer-mid",
  eqHigh: "music-equalizer-high",
  loopMode: "music-loop-mode",
};

export const DEFAULT_LISTENER_SETTINGS: PersistedListenerSettings = {
  rate: 1,
  volume: 1,
  separationEnabled: false,
  playbackMode: "original",
  vocalVolume: 1,
  instrumentalVolume: 1,
  eqLow: 0,
  eqMid: 0,
  eqHigh: 0,
  loopMode: "all",
};

const parseFloatOr = (raw: string | null, fallback: number): number => {
  if (raw === null) return fallback;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
};

const parseMode = (raw: string | null): PlaybackMode =>
  raw === "instrumental" || raw === "vocals" ? raw : "original";

const parseLoop = (raw: string | null): LoopMode =>
  raw === "none" || raw === "one" || raw === "all" ? raw : "all";

export const loadListenerSettings = (): PersistedListenerSettings => ({
  rate: parseFloatOr(kvGet(KEYS.rate), DEFAULT_LISTENER_SETTINGS.rate),
  volume: parseFloatOr(kvGet(KEYS.volume), DEFAULT_LISTENER_SETTINGS.volume),
  separationEnabled: kvGet(KEYS.separationEnabled) === "true",
  playbackMode: parseMode(kvGet(KEYS.playbackMode)),
  vocalVolume: parseFloatOr(kvGet(KEYS.vocalVolume), DEFAULT_LISTENER_SETTINGS.vocalVolume),
  instrumentalVolume: parseFloatOr(
    kvGet(KEYS.instrumentalVolume),
    DEFAULT_LISTENER_SETTINGS.instrumentalVolume,
  ),
  eqLow: parseFloatOr(kvGet(KEYS.eqLow), 0),
  eqMid: parseFloatOr(kvGet(KEYS.eqMid), 0),
  eqHigh: parseFloatOr(kvGet(KEYS.eqHigh), 0),
  loopMode: parseLoop(kvGet(KEYS.loopMode)),
});

const serialize = (key: keyof PersistedListenerSettings, value: unknown): string => {
  if (key === "playbackMode") {
    // "custom" is never restored; store it as the plain mix it plays.
    return value === "custom" ? "original" : String(value);
  }
  return String(value);
};

export const createListenerSettingsPersistence = (): ListenerSettingsPersistence => {
  const pending = new Map<keyof PersistedListenerSettings, string>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = (): void => {
    timer = null;
    for (const [key, value] of pending) kvSet(KEYS[key], value);
    pending.clear();
  };

  return {
    load: loadListenerSettings,
    save(patch) {
      for (const key of Object.keys(patch) as (keyof PersistedListenerSettings)[]) {
        const value = patch[key];
        if (value === undefined) continue;
        pending.set(key, serialize(key, value));
      }
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(flush, WRITE_DEBOUNCE_MS);
    },
  };
};
