import { describe, expect, it } from "bun:test";
import { albumKey, isAlbumKey } from "../albumKey";

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
