import { describe, expect, it } from "bun:test";
import { parseDeepLink } from "../deepLinks";

describe("parseDeepLink", () => {
  it("strips the locale prefix for every locale", () => {
    for (const locale of ["en", "pt", "lv"]) {
      expect(parseDeepLink(`https://omelhorsite.pt/${locale}/music/discover/`)).toEqual({
        kind: "home",
      });
    }
  });

  it("parses ?id= detail routes", () => {
    expect(parseDeepLink("https://omelhorsite.pt/pt/music/playlist/?id=12")).toEqual({
      kind: "playlist",
      id: 12,
    });
  });

  it("falls back to the playlists list on a missing/invalid id", () => {
    expect(parseDeepLink("https://omelhorsite.pt/pt/music/playlist/")).toEqual({
      kind: "playlists",
    });
    expect(parseDeepLink("https://omelhorsite.pt/pt/music/playlist/?id=abc")).toEqual({
      kind: "playlists",
    });
  });

  it("parses ?slug= mix routes (URL-encoded, contains colons)", () => {
    expect(
      parseDeepLink("https://omelhorsite.pt/en/music/mix/?slug=mix%3Atop_artist%3A7"),
    ).toEqual({ kind: "mix", slug: "mix:top_artist:7" });
  });

  it("handles BOTH album URL forms", () => {
    const viaArtist = parseDeepLink(
      "https://omelhorsite.pt/pt/music/artist/carlos-paiao/Cinderela",
    );
    const viaAlbum = parseDeepLink(
      "https://omelhorsite.pt/pt/music/album/carlos-paiao/Cinderela",
    );
    expect(viaArtist).toEqual({
      kind: "album",
      artist: "carlos-paiao",
      album: "Cinderela",
      highlight: null,
    });
    expect(viaAlbum).toEqual(viaArtist);
  });

  it("decodes URL-encoded artist names in the segment", () => {
    expect(
      parseDeepLink("https://omelhorsite.pt/en/music/artist/Carlos%20Pai%C3%A3o"),
    ).toEqual({ kind: "artist", artist: "Carlos Paião" });
  });

  it('preserves the literal "null" album segment as unknown album', () => {
    expect(
      parseDeepLink("https://omelhorsite.pt/pt/music/artist/carlos-paiao/null"),
    ).toEqual({ kind: "album", artist: "carlos-paiao", album: null, highlight: null });
  });

  it("extracts the #title highlight hash (FR-44)", () => {
    expect(
      parseDeepLink("https://omelhorsite.pt/pt/music/artist/x/y#P%C3%B3%20de%20Arroz"),
    ).toEqual({ kind: "album", artist: "x", album: "y", highlight: "Pó de Arroz" });
  });

  it("parses radio routes with fallbacks to home", () => {
    expect(parseDeepLink("https://omelhorsite.pt/pt/music/radio/song/?id=9")).toEqual({
      kind: "radioSong",
      id: 9,
    });
    expect(
      parseDeepLink("https://omelhorsite.pt/pt/music/radio/artist/?artist=carlos-paiao"),
    ).toEqual({ kind: "radioArtist", artist: "carlos-paiao" });
    expect(parseDeepLink("https://omelhorsite.pt/pt/music/radio/song/")).toEqual({
      kind: "home",
    });
  });

  it("parses the omsmusic:// custom scheme with and without the music prefix", () => {
    expect(parseDeepLink("omsmusic://music/liked")).toEqual({ kind: "liked" });
    expect(parseDeepLink("omsmusic://liked")).toEqual({ kind: "liked" });
    expect(parseDeepLink("omsmusic://playlist?id=3")).toEqual({ kind: "playlist", id: 3 });
  });

  it("parses search with its query", () => {
    expect(parseDeepLink("https://omelhorsite.pt/en/music/search/?query=abba")).toEqual({
      kind: "search",
      query: "abba",
    });
  });

  it("returns null for non-music URLs", () => {
    expect(parseDeepLink("https://omelhorsite.pt/pt/movies/")).toBeNull();
  });

  it("redirects the bare artist segment to the artists list", () => {
    expect(parseDeepLink("https://omelhorsite.pt/pt/music/artist/")).toEqual({
      kind: "artists",
    });
    expect(parseDeepLink("https://omelhorsite.pt/pt/music/artist/null")).toEqual({
      kind: "artists",
    });
  });
});
