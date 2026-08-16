import { describe, expect, it } from "bun:test";
import { albumKey, artistKey, isAlbumKey, isArtistKey } from "../albumKey";

describe("albumKey", () => {
  it("builds the composite lowercased key", () => {
    expect(albumKey("carlos-paiao", "Cinderela")).toBe("album:carlos-paiao:cinderela");
  });

  it('maps null parts to "null" (unknown album/artist)', () => {
    expect(albumKey(null, null)).toBe("album:null:null");
    expect(albumKey("x", null)).toBe("album:x:null");
  });

  it("is deterministic across case variants", () => {
    expect(albumKey("X", "ThE AlBuM")).toBe(albumKey("x", "the album"));
  });

  it("isAlbumKey distinguishes album keys from playlist ids", () => {
    expect(isAlbumKey("album:a:b")).toBeTruthy();
    expect(isAlbumKey("123")).toBeFalsy();
  });
});

describe("artistKey", () => {
  it("builds the lowercased artist key", () => {
    expect(artistKey("Laura-Les")).toBe("artist:laura-les");
    expect(artistKey(null)).toBe("artist:null");
  });

  it("nunca colide com chaves de álbum nem com ids de playlist", () => {
    expect(isArtistKey(artistKey("x"))).toBeTruthy();
    expect(isAlbumKey(artistKey("x"))).toBeFalsy();
    expect(isArtistKey("album:x:y")).toBeFalsy();
    expect(isArtistKey("123")).toBeFalsy();
  });
});
