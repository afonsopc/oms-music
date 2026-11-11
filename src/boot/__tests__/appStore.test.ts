/**
 * App Store gate (docs/app-store.md). Importing music from outside (other
 * services, links, video sites) lives in a separate service and page; the iOS
 * and Android apps must carry no trace of it. Two checks:
 *
 *  1. no source file that Metro can bundle into iOS/Android (everything under
 *     src/ except `*.web.ts(x)` and `__tests__`), and none of the i18n
 *     catalogs, names those services or the import page, nor the sites the
 *     import gets lyrics, artist photos and bios from (2026-11-11: the apps
 *     only show what each person has in their own library, "Content
 *     Rights");
 *  2. the patched SDK (patches/, applied by `bun install`) no longer ships the
 *     import, sync, match and external-search namespaces.
 *
 * The words are assembled from pieces so this file does not trip a plain
 * grep of the repo.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const REPO_ROOT = new URL("../../../", import.meta.url).pathname;
const SRC = join(REPO_ROOT, "src");

const words = (...parts: string[][]): string[] => parts.map((p) => p.join(""));

const FORBIDDEN_IN_APP = words(
  ["spo", "tify"],
  ["you", "tube"],
  ["sound", "cloud"],
  ["band", "camp"],
  ["yt-", "dlp"],
  ["import.", "omelhorsite"],
);

/** Where the import service finds lyrics, artist photos, bios and similar artists. */
const CONTENT_SOURCES = words(
  ["lrc", "lib"],
  ["gen", "ius"],
  ["dee", "zer"],
  ["last", ".fm"],
  ["audio", "scrobbler"],
  ["music", "brainz"],
  ["wiki", "pedia"],
);

const FORBIDDEN_IN_SDK = [
  ...FORBIDDEN_IN_APP,
  ...words(
    ["song_", "imports"],
    ["external_", "search"],
    ["re", "match"],
    ["match_", "candidates"],
    ["artist_", "imports"],
    ["artist_", "syncs"],
    ["playlist_", "imports"],
    ["itu", "nes"],
    ["tools_", "downloader"],
  ),
];

const isWebOnly = (name: string): boolean => /\.web\.(ts|tsx|js|jsx)$/.test(name);

const nativeSources = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") continue;
      out.push(...nativeSources(full));
    } else if (/\.(ts|tsx|js|jsx|json)$/.test(entry.name) && !isWebOnly(entry.name)) {
      out.push(full);
    }
  }
  return out;
};

const hits = (files: string[], forbidden: string[]): string[] => {
  const found: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8").toLowerCase();
    for (const word of forbidden) {
      if (text.includes(word)) found.push(`${relative(REPO_ROOT, file)}: ${word}`);
    }
  }
  return found;
};

describe("App Store gate", () => {
  it("keeps outside-import words out of every native-bundled source and catalog", () => {
    const files = nativeSources(SRC);
    expect(files.some((f) => f.endsWith("catalogs/pt.json"))).toBe(true);
    expect(hits(files, FORBIDDEN_IN_APP)).toEqual([]);
  });

  it("keeps the lyrics and artist-photo sources out of every native-bundled source and catalog", () => {
    expect(hits(nativeSources(SRC), CONTENT_SOURCES)).toEqual([]);
  });

  it("ships the SDK patched (bun install applies patches/)", () => {
    const sdk = join(REPO_ROOT, "node_modules/@omelhorsite/sdk/dist/index.js");
    expect(hits([sdk], FORBIDDEN_IN_SDK)).toEqual([]);
  });
});
