/**
 * The home-open artwork scope. Warming the wrong ids is invisible twice over:
 * too few and the grid paints placeholders on a warm boot, too many and the
 * sweep spends the user's data on tiles nobody will see.
 */
import { describe, expect, it } from "bun:test";
import { artworkScope, MAX_HOME_ARTWORK } from "../artworkScope";
import type { Artist } from "@/domain/artist";
import type { FsNodeId } from "@/domain/ids";

const node = (value: string): FsNodeId => value as FsNodeId;

const playlist = (id: string | null) => ({ artwork_media_id: id as FsNodeId | null });
const album = (id: string | null) => ({ artwork_media_id: id });
const recent = (id: string | null) => ({ artworkNodeId: id });
const mix = (compressed: string | null, original: string | null) => ({
  artist: { compressed_image_media_id: compressed, image_media_id: original } as Artist,
});

describe("artworkScope", () => {
  it("returns the four sources in tap-likelihood order", () => {
    expect(
      artworkScope({
        playlists: [playlist("1")],
        recentAlbums: [album("2")],
        mixes: [mix(null, "3")],
        recentCollections: [recent("4")],
      }),
    ).toEqual([node("1"), node("2"), node("3"), node("4")]);
  });

  it("drops nulls and empty strings", () => {
    expect(
      artworkScope({
        playlists: [playlist(null), playlist(""), playlist("7")],
        recentAlbums: [album(null)],
        recentCollections: [recent(null)],
      }),
    ).toEqual([node("7")]);
  });

  it("dedupes across sources, keeping the first occurrence", () => {
    expect(
      artworkScope({
        playlists: [playlist("5"), playlist("5")],
        recentAlbums: [album("5")],
        recentCollections: [recent("5"), recent("6")],
      }),
    ).toEqual([node("5"), node("6")]);
  });

  it("prefers the compressed artist image for mix tiles", () => {
    expect(artworkScope({ mixes: [mix("9", "8")] })).toEqual([node("9")]);
    expect(artworkScope({ mixes: [mix(null, "8")] })).toEqual([node("8")]);
  });

  it("tolerates a mix with no seed artist", () => {
    expect(artworkScope({ mixes: [{ artist: null }] })).toEqual([]);
  });

  it("caps at 32 by default and the cap honours the order", () => {
    const many = Array.from({ length: 100 }, (_, i) => playlist(`p${i}`));
    const scope = artworkScope({ many_unused: undefined, playlists: many } as never);
    expect(scope.length).toBe(MAX_HOME_ARTWORK);
    expect(scope[0]).toBe(node("p0"));
    expect(scope[MAX_HOME_ARTWORK - 1]).toBe(node("p31"));
  });

  it("never spends the cap on later sources when the first one fills it", () => {
    const many = Array.from({ length: 40 }, (_, i) => playlist(`p${i}`));
    const scope = artworkScope({ playlists: many, recentAlbums: [album("late")] });
    expect(scope).not.toContain(node("late"));
  });

  it("accepts a smaller explicit limit", () => {
    expect(artworkScope({ playlists: [playlist("a"), playlist("b")] }, 1)).toEqual([node("a")]);
  });

  it("returns an empty list when nothing is cached yet", () => {
    expect(artworkScope({})).toEqual([]);
    expect(artworkScope({ playlists: null, mixes: null })).toEqual([]);
  });
});
