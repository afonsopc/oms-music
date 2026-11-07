import { describe, expect, it } from "bun:test";
import {
  buildSyncedTranslationMap,
  isTranslationTarget,
  normalizeLyricLine,
  sameLyricLine,
  translationApplies,
  plainTranslationFor,
  splitPlainLines,
  syncedTranslationFor,
} from "../translation";
import { NO_LYRICS, offlineLyricsFromRow } from "../offline";

describe("synced translation alignment (FR-79: key by time.toFixed(2))", () => {
  const original = { time: 12.34, text: "Ola mundo" };

  it("aligns one-to-one by timestamp string", () => {
    const map = buildSyncedTranslationMap("[00:12.34]Hello world\n[00:15.10]Second");
    expect(map).not.toBeNull();
    expect(syncedTranslationFor(map, original)).toBe("Hello world");
  });

  it("suppresses translations identical to the original line", () => {
    const map = buildSyncedTranslationMap("[00:12.34]Ola mundo");
    expect(syncedTranslationFor(map, original)).toBeNull();
  });

  it("returns null for missing timestamps, empty translations and no map", () => {
    const map = buildSyncedTranslationMap("[00:99.00]Elsewhere\n[00:12.34]");
    expect(syncedTranslationFor(map, original)).toBeNull();
    expect(syncedTranslationFor(null, original)).toBeNull();
    expect(buildSyncedTranslationMap(null)).toBeNull();
    expect(buildSyncedTranslationMap("")).toBeNull();
  });

  it("keys with two decimals so 12.3 and 12.30 collide as intended", () => {
    const map = buildSyncedTranslationMap("[00:12.3]Hello");
    expect(syncedTranslationFor(map, { time: 12.3, text: "x" })).toBe("Hello");
  });
});

describe("plain translation alignment (FR-79: by line index)", () => {
  const translated = splitPlainLines("Hello\nSame line\nThird");

  it("aligns by index and suppresses identical lines", () => {
    expect(plainTranslationFor(translated, 0, "Ola")).toBe("Hello");
    expect(plainTranslationFor(translated, 1, "Same line")).toBeNull();
    expect(plainTranslationFor(translated, 2, "Terceira")).toBe("Third");
  });

  it("returns null out of range, for empty lines and without a translation", () => {
    expect(plainTranslationFor(translated, 9, "x")).toBeNull();
    expect(plainTranslationFor(["", "b"], 0, "a")).toBeNull();
    expect(plainTranslationFor(null, 0, "a")).toBeNull();
  });

  it("splitPlainLines handles CRLF", () => {
    expect(splitPlainLines("a\r\nb\nc")).toEqual(["a", "b", "c"]);
  });
});

describe("isTranslationTarget", () => {
  it("accepts exactly the seven targets", () => {
    for (const code of ["pt", "en", "es", "fr", "de", "it", "lv"]) {
      expect(isTranslationTarget(code)).toBeTruthy();
    }
    expect(isTranslationTarget("br")).toBeFalsy();
    expect(isTranslationTarget("")).toBeFalsy();
    expect(isTranslationTarget(null)).toBeFalsy();
  });
});

describe("offline lyrics tri-state (FR-81 read half)", () => {
  it("unfetched or missing rows give no offline answer", () => {
    expect(offlineLyricsFromRow(null)).toBeNull();
    expect(offlineLyricsFromRow(undefined)).toBeNull();
    expect(offlineLyricsFromRow({ lyrics_state: "unfetched", lyrics_json: null })).toBeNull();
  });

  it('"none" answers with the all-null Lyrics shape (never refetched forever)', () => {
    expect(offlineLyricsFromRow({ lyrics_state: "none", lyrics_json: null })).toEqual(NO_LYRICS);
  });

  it('"cached" parses the stored payload defensively', () => {
    const row = {
      lyrics_state: "cached" as const,
      lyrics_json: JSON.stringify({ synced: "[00:01.00]x", plain: "x", attribution: "lrclib.net" }),
    };
    expect(offlineLyricsFromRow(row)).toEqual({
      synced: "[00:01.00]x",
      plain: "x",
      attribution: "lrclib.net",
    });
  });

  it("corrupt cached json falls through instead of faking an empty state", () => {
    expect(offlineLyricsFromRow({ lyrics_state: "cached", lyrics_json: "{oops" })).toBeNull();
    expect(offlineLyricsFromRow({ lyrics_state: "cached", lyrics_json: null })).toBeNull();
    expect(offlineLyricsFromRow({ lyrics_state: "cached", lyrics_json: "null" })).toBeNull();
  });
});

describe("same line after normalising, and same language (2026-11-07)", () => {
  it("hides a 'translation' that only adds punctuation, case or accents", () => {
    const map = buildSyncedTranslationMap("[00:12.34]Coisa fofa, nunca vi\n[00:15.00]está bem ou nao vens?");
    expect(syncedTranslationFor(map, { time: 12.34, text: "Coisa fofa nunca vi" })).toBeNull();
    expect(syncedTranslationFor(map, { time: 15, text: "Está bem ou não vens" })).toBeNull();
    expect(plainTranslationFor(["Sempre juntos, eu prometo!"], 0, "Sempre  juntos eu prometo")).toBeNull();
  });

  it("keeps a real translation, in any script", () => {
    expect(sameLyricLine("Hello", "Olá")).toBe(false);
    expect(sameLyricLine("Ты моя", "ты моя!")).toBe(true);
    expect(normalizeLyricLine("  Está bem, OU NÃO?  ")).toBe("esta bem ou nao");
  });

  it("no translation into the language the song is sung in", () => {
    expect(translationApplies("pt", "pt")).toBe(false);
    expect(translationApplies("pt-PT", "pt")).toBe(false);
    expect(translationApplies("en", "pt")).toBe(true);
    expect(translationApplies(null, "pt")).toBe(true);
  });
});
