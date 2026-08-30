import { describe, expect, it } from "bun:test";
import {
  importPercent,
  isImportTerminal,
  providerFromExtractor,
  songImportBody,
  tracksFromPreview,
  type ImportableTrack,
} from "../urlImport";
import type { DownloaderPreview } from "@/domain/imports";

const track = (overrides: Partial<ImportableTrack> = {}): ImportableTrack => ({
  key: "https://youtu.be/1",
  webpageUrl: "https://youtu.be/1",
  title: "Obedient",
  artist: "Bladee",
  album: "Icedancer",
  durationS: 213,
  extractor: "youtube:tab",
  sourceId: "abc",
  thumbnailUrl: "https://img/thumb.jpg",
  artwork: null,
  ...overrides,
});

describe("tracksFromPreview (FR-101)", () => {
  it("drops tracks with no webpage_url - there is nothing to download", () => {
    const preview: DownloaderPreview = {
      kind: "playlist",
      title: "Mix",
      count: 3,
      tracks: [
        { title: "A", webpage_url: "https://a" },
        { title: "B" },
        { title: "C", webpage_url: "https://c" },
      ],
    };
    expect(tracksFromPreview(preview).map((t) => t.title)).toEqual(["A", "C"]);
  });

  it("keeps the largest thumbnail of a single-track preview", () => {
    const preview: DownloaderPreview = {
      kind: "track",
      title: "A",
      webpage_url: "https://a",
      thumbnails: [{ url: "small" }, { url: "large" }],
    };
    expect(tracksFromPreview(preview)[0]!.thumbnailUrl).toBe("large");
  });

  it("a track preview without a webpage_url yields nothing", () => {
    expect(tracksFromPreview({ kind: "track", title: "A" })).toHaveLength(0);
  });
});

describe("providerFromExtractor", () => {
  it("takes the extractor up to the first colon", () => {
    expect(providerFromExtractor("youtube:tab")).toBe("youtube");
    expect(providerFromExtractor("soundcloud")).toBe("soundcloud");
    expect(providerFromExtractor(undefined)).toBeUndefined();
  });
});

describe("songImportBody (FR-101 request shape)", () => {
  it("sends URL mode with provider, id and positions when a playlist target exists", () => {
    const body = songImportBody(track(), 12, 3);
    expect(body.sourceUrl).toBe("https://youtu.be/1");
    expect(body.sourceKind).toBe("yt_dlp");
    expect(body.sourceProvider).toBe("youtube");
    expect(body.sourceId).toBe("abc");
    expect(body.playlistId).toBe(12);
    expect(body.position).toBe(3);
    expect(body.expectedDurationS).toBe(213);
  });

  it("omits playlistId and position for a library-only import", () => {
    const body = songImportBody(track(), null, 1);
    expect("playlistId" in body).toBe(false);
    expect("position" in body).toBe(false);
  });

  it("omits blank overrides instead of sending empty strings", () => {
    const body = songImportBody(track({ title: "", artist: "  ", album: "" }), null, 1);
    expect("overrideTitle" in body).toBe(false);
    expect("overrideArtist" in body).toBe(false);
    expect("overrideAlbum" in body).toBe(false);
  });

  it("falls back to the preview thumbnail when no artwork was picked", () => {
    const body = songImportBody(track(), null, 1);
    expect(body.artworkUrl).toBe("https://img/thumb.jpg");
    expect("artworkDataB64" in body).toBe(false);
  });

  it("sends artworkUrl or artworkDataB64, never both", () => {
    const url = songImportBody(track({ artwork: { kind: "url", url: "https://cover" } }), null, 1);
    expect(url.artworkUrl).toBe("https://cover");
    expect("artworkDataB64" in url).toBe(false);

    const data = songImportBody(track({ artwork: { kind: "data", base64: "AAA" } }), null, 1);
    expect(data.artworkDataB64).toBe("AAA");
    expect("artworkUrl" in data).toBe(false);
  });
});

describe("import progress (FR-102)", () => {
  it("progress_pct is a float 0..1 shown as a clamped percentage", () => {
    expect(importPercent(0.5)).toBe(50);
    expect(importPercent(null)).toBe(0);
    expect(importPercent(1)).toBe(100);
    expect(importPercent(2)).toBe(100);
  });

  it("a deduped create is already terminal - never polled", () => {
    expect(isImportTerminal({ state: "complete", deduped: true })).toBe(true);
    expect(isImportTerminal({ state: "pending", deduped: true })).toBe(true);
    expect(isImportTerminal({ state: "processing", deduped: false })).toBe(false);
    expect(isImportTerminal({ state: "failed", deduped: false })).toBe(true);
  });
});
