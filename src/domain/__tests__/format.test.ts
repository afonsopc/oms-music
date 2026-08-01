/**
 * Artist-line formatting, with the wire shape of `artist_names` under test:
 * the backend serializers that emit it (Listening::Snapshot.song_hash,
 * Jams::Serializer) comma-JOIN the names into a string, so nothing may treat
 * it as an array.
 */
import { describe, expect, it } from "bun:test";
import type { SongArtistEntry } from "../song";
import {
  artistNamesLine,
  artistNamesList,
  formatArtists,
  formatArtistsFull,
  primaryArtistSlug,
} from "../format";

const entry = (
  name: string,
  role: SongArtistEntry["role"],
  position: number,
  slug = "",
): SongArtistEntry =>
  ({ name, role, position, slug, id: position, song_id: 1, artist_id: position }) as SongArtistEntry;

describe("artistNamesLine / artistNamesList", () => {
  it("accepts the comma-joined string the backend actually sends", () => {
    expect(artistNamesLine("Carlos Paiao, Xutos")).toBe("Carlos Paiao, Xutos");
    expect(artistNamesList("Carlos Paiao, Xutos")).toEqual(["Carlos Paiao", "Xutos"]);
  });

  it("accepts the legacy array shape", () => {
    expect(artistNamesLine(["Carlos Paiao", "Xutos"])).toBe("Carlos Paiao, Xutos");
    expect(artistNamesList(["Carlos Paiao", "Xutos"])).toEqual(["Carlos Paiao", "Xutos"]);
  });

  it("answers empty for absent, empty and junk values", () => {
    for (const value of [undefined, null, "", [], 42, {}]) {
      expect(artistNamesLine(value)).toBe("");
      expect(artistNamesList(value)).toEqual([]);
    }
  });
});

describe("formatArtists", () => {
  it("sorts by position and splits primary from featured", () => {
    const song = {
      artists: [entry("B", "featured", 2), entry("A", "primary", 1), entry("C", "with", 3)],
    };
    expect(formatArtists(song)).toBe("A (feat. B)");
    expect(formatArtistsFull(song)).toBe("A (feat. B) (with C)");
  });

  it("never throws on a jam proposal with no artist rows", () => {
    // Jams::Serializer.proposal_song_hash: artists: [], artist_names: "".
    expect(formatArtists({ artists: [], artist_names: "" })).toBe("");
    expect(formatArtists({ artists: [], artist_names: "Carlos Paiao, Xutos" })).toBe(
      "Carlos Paiao, Xutos",
    );
    expect(formatArtists({})).toBe("");
  });
});

describe("primaryArtistSlug", () => {
  it("prefers the primary slug, then the name", () => {
    expect(primaryArtistSlug({ artists: [entry("Carlos", "primary", 1, "carlos")] })).toBe(
      "carlos",
    );
    expect(primaryArtistSlug({ artists: [entry("Carlos Paiao", "primary", 1)] })).toBe(
      "Carlos%20Paiao",
    );
  });

  it("falls back to the FIRST NAME of artist_names, not its first character", () => {
    expect(primaryArtistSlug({ artists: [], artist_names: "Carlos Paiao, Xutos" })).toBe(
      "Carlos%20Paiao",
    );
    expect(primaryArtistSlug({ artist_names: ["Carlos Paiao"] })).toBe("Carlos%20Paiao");
    expect(primaryArtistSlug({ artists: [], artist_names: "" })).toBe("null");
    expect(primaryArtistSlug({})).toBe("null");
  });
});
