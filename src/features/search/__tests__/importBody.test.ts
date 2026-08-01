/**
 * FR-34 request shapes. Getting these wrong is a silent 400 or, worse, a
 * wrong-track download: URL mode must never carry search_* keys, search
 * mode must never carry source_url, and absent values must be OMITTED
 * (a null would travel as the "\b" sentinel).
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
    expect(body.source_url).toBe("https://example.test/abc123");
    expect(body.search_artist).toBeUndefined();
    expect(body.search_title).toBeUndefined();
    expect(body.isrc).toBeUndefined();
  });

  it("uses search mode with the isrc for spotify, itunes and bandcamp", () => {
    for (const source of ["spotify", "itunes", "bandcamp"] as const) {
      const body = buildImportBody(track({ source }));
      expect(body.source_url).toBeUndefined();
      expect(body.search_artist).toBe("Carlos Paiao");
      expect(body.search_title).toBe("Cinderela");
      expect(body.search_album).toBe("Playback");
      expect(body.isrc).toBe("PTAAA0000001");
    }
  });

  it("falls back to search mode when a URL-mode hit has no url", () => {
    const body = buildImportBody(track({ source: "soundcloud", source_url: null }));
    expect(body.source_url).toBeUndefined();
    expect(body.search_title).toBe("Cinderela");
  });

  it("always carries the source and override metadata", () => {
    const body = buildImportBody(track({ source: "youtube" }));
    expect(body.source_provider).toBe("youtube");
    expect(body.source_id).toBe("abc123");
    expect(body.override_title).toBe("Cinderela");
    expect(body.override_artist).toBe("Carlos Paiao");
    expect(body.override_album).toBe("Playback");
    expect(body.artwork_url).toBe("https://example.test/art.jpg");
    expect(body.expected_duration_s).toBe(187);
  });

  it("omits absent optionals instead of sending nulls", () => {
    const body = buildImportBody(
      track({ album: null, isrc: null, artwork_url: null, duration_ms: null }),
    );
    expect("override_album" in body).toBeFalsy();
    expect("search_album" in body).toBeFalsy();
    expect("artwork_url" in body).toBeFalsy();
    expect("expected_duration_s" in body).toBeFalsy();
    expect("isrc" in body).toBeFalsy();
  });
});
