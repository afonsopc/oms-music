/**
 * FR-34 request shapes. Getting these wrong is a silent 400 or, worse, a
 * wrong-track download: URL mode must never carry search* keys, search
 * mode must never carry sourceUrl, and absent values must be OMITTED
 * (the SDK keeps a null and the server would read it as an explicit empty).
 */
import { describe, expect, it } from "bun:test";
import type { ExternalSearchResult } from "@/domain/imports";
import { buildImportBody } from "../importBody";

const track = (overrides: Partial<ExternalSearchResult> = {}): ExternalSearchResult => ({
  source: "spotify",
  kind: "track",
  source_id: "abc123",
  source_url: "https://example.test/abc123",
  title: "Cinderela",
  artist: "Carlos Paiao",
  album: "Playback",
  duration_ms: 187_000,
  isrc: "PTAAA0000001",
  artwork_url: "https://example.test/art.jpg",
  ...overrides,
});

describe("buildImportBody", () => {
  it("uses URL mode for youtube and soundcloud", () => {
    const body = buildImportBody(track({ source: "youtube" }));
    expect(body.sourceUrl).toBe("https://example.test/abc123");
    expect(body.searchArtist).toBeUndefined();
    expect(body.searchTitle).toBeUndefined();
    expect(body.isrc).toBeUndefined();
  });

  it("uses search mode with the isrc for spotify, itunes and bandcamp", () => {
    for (const source of ["spotify", "itunes", "bandcamp"] as const) {
      const body = buildImportBody(track({ source }));
      expect(body.sourceUrl).toBeUndefined();
      expect(body.searchArtist).toBe("Carlos Paiao");
      expect(body.searchTitle).toBe("Cinderela");
      expect(body.searchAlbum).toBe("Playback");
      expect(body.isrc).toBe("PTAAA0000001");
    }
  });

  it("falls back to search mode when a URL-mode hit has no url", () => {
    const body = buildImportBody(track({ source: "soundcloud", source_url: null }));
    expect(body.sourceUrl).toBeUndefined();
    expect(body.searchTitle).toBe("Cinderela");
  });

  it("always carries the source and override metadata", () => {
    const body = buildImportBody(track({ source: "youtube" }));
    expect(body.sourceProvider).toBe("youtube");
    expect(body.sourceId).toBe("abc123");
    expect(body.overrideTitle).toBe("Cinderela");
    expect(body.overrideArtist).toBe("Carlos Paiao");
    expect(body.overrideAlbum).toBe("Playback");
    expect(body.artworkUrl).toBe("https://example.test/art.jpg");
    expect(body.expectedDurationS).toBe(187);
  });

  it("omits absent optionals instead of sending nulls", () => {
    const body = buildImportBody(
      track({ album: null, isrc: null, artwork_url: null, duration_ms: null }),
    );
    expect("overrideAlbum" in body).toBeFalsy();
    expect("searchAlbum" in body).toBeFalsy();
    expect("artworkUrl" in body).toBeFalsy();
    expect("expectedDurationS" in body).toBeFalsy();
    expect("isrc" in body).toBeFalsy();
  });
});
