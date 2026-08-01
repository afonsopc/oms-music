/**
 * The fs node -> song key reverse index behind offline artwork (FR-91). The
 * album/artist/rail surfaces only ever quote a node id, so this is the map
 * that decides whether their tiles show the downloaded jpg or the grey
 * placeholder in airplane mode.
 */
import { describe, expect, it } from "bun:test";
import type { FsNodeId, SongKey } from "@/domain/ids";
import { ArtworkNodeIndex, artworkNodeIdsOf } from "../artworkIndex";

const song = (compressed: string | null, original: string | null) => ({
  compressed_artwork_fs_node_id: compressed as FsNodeId | null,
  artwork_fs_node_id: original as FsNodeId | null,
});

const key = (value: string): SongKey => value as SongKey;
const node = (value: string): FsNodeId => value as FsNodeId;

describe("artworkNodeIdsOf", () => {
  it("lists both ids, compressed first, deduplicated", () => {
    expect(artworkNodeIdsOf(song("c1", "o1"))).toEqual([node("c1"), node("o1")]);
    expect(artworkNodeIdsOf(song("same", "same"))).toEqual([node("same")]);
    expect(artworkNodeIdsOf(song(null, "o1"))).toEqual([node("o1")]);
    expect(artworkNodeIdsOf(song(null, null))).toEqual([]);
  });
});

describe("ArtworkNodeIndex", () => {
  it("answers for either artwork node id of a downloaded song", () => {
    const index = new ArtworkNodeIndex();
    index.add(key("1"), song("c1", "o1"));
    expect(index.songKeysFor(node("c1"))).toEqual([key("1")]);
    expect(index.songKeysFor(node("o1"))).toEqual([key("1")]);
    expect(index.songKeysFor(node("nope"))).toEqual([]);
  });

  it("keeps every song that quotes a shared node id", () => {
    const index = new ArtworkNodeIndex();
    index.add(key("1"), song("shared", null));
    index.add(key("2"), song("shared", null));
    index.add(key("2"), song("shared", null)); // re-download: no duplicate
    expect(index.songKeysFor(node("shared"))).toEqual([key("1"), key("2")]);
  });

  it("removes only the song asked for", () => {
    const index = new ArtworkNodeIndex();
    index.add(key("1"), song("shared", null));
    index.add(key("2"), song("shared", "o2"));
    index.remove(key("1"), song("shared", null));
    expect(index.songKeysFor(node("shared"))).toEqual([key("2")]);
    index.remove(key("2"), song("shared", "o2"));
    expect(index.songKeysFor(node("shared"))).toEqual([]);
    expect(index.songKeysFor(node("o2"))).toEqual([]);
  });

  it("clears wholesale on session end", () => {
    const index = new ArtworkNodeIndex();
    index.add(key("1"), song("c1", "o1"));
    index.clear();
    expect(index.songKeysFor(node("c1"))).toEqual([]);
  });
});
