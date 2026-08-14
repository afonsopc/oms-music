/**
 * The repair walk's payload choice (verifyAndRepair -> planReconciliation).
 *
 * The pass used to re-issue the STORED Song payload for every stored song,
 * which made media-id reconciliation structurally impossible: enqueueKind
 * compared the stored ids against themselves and always matched, so a
 * re-transcoded song kept playing its old master forever. The walk now hands
 * `downloadSong` the freshest payload it has, and THAT is what gives the id
 * comparison something to compare against.
 *
 * Only the choice is tested here: the pass itself talks to SQLite, the file
 * system and the network, none of which belong in a unit test, and the drop
 * half already lives inside enqueueKind.
 */
import { describe, expect, it } from "bun:test";
import type { SongId, SongKey } from "@/domain/ids";
import type { Song } from "@/domain/song";
import { planReconciliation, staleKinds, type StoredSongRef } from "../reconcile";

const key = (v: string): SongKey => v as SongKey;

const song = (id: number, over: Partial<Song> = {}): Song =>
  ({
    id: id as SongId,
    title: `song ${id}`,
    updated_at: "2026-01-01T00:00:00Z",
    audio_media_id: `${id}00`,
    compressed_audio_media_id: `${id}01`,
    artwork_media_id: `${id}02`,
    compressed_artwork_media_id: `${id}03`,
    vocals_media_id: null,
    instrumental_media_id: null,
    ...over,
  }) as Song;

/** A small offline library: three songs the user actually downloaded. */
const library: StoredSongRef[] = [
  { songKey: key("1"), song: song(1) },
  { songKey: key("2"), song: song(2) },
  { songKey: key("3"), song: song(3) },
];

describe("verifyAndRepair payload choice", () => {
  it("re-issues the stored payload when the query cache is cold (offline repair)", () => {
    const plan = planReconciliation(library, new Map());
    expect(plan.map((p) => p.song)).toEqual(library.map((l) => l.song));
    expect(plan.every((p) => !p.stale && !p.refreshed)).toBe(true);
  });

  it("re-issues the FRESH payload for a re-transcoded song and flags it", () => {
    // The backend replaced the audio attachment: a new ActiveStorage id, and
    // (the case that used to be missed entirely) the SAME updated_at.
    const retranscoded = song(2, { compressed_audio_media_id: "9999" });
    const plan = planReconciliation(library, new Map([[2 as SongId, retranscoded]]));

    const touched = plan.find((p) => p.songKey === key("2"));
    expect(touched?.song).toBe(retranscoded);
    expect(touched?.stale).toBe(true);

    // And nothing else in the library is disturbed by one song moving.
    expect(plan.filter((p) => p.stale).length).toBe(1);
  });

  it("hands the fresh payload the stale kinds enqueueKind will drop", () => {
    const retranscoded = song(2, { compressed_audio_media_id: "9999" });
    // What dl_files is holding for song 2 right now.
    const rows = [
      { kind: "mixed" as const, node_id: "201", status: "done" },
      { kind: "mixed_original" as const, node_id: "200", status: "done" },
      { kind: "artwork" as const, node_id: "203", status: "done" },
    ];
    // ONLY the mix is wrong: the master and the cover were never replaced, so
    // a repair pass must not re-download them.
    expect(staleKinds(retranscoded, rows)).toEqual(["mixed"]);
  });

  it("still prefers the fresh payload when only metadata moved", () => {
    // A rename must reach dl_songs (the Downloads screen renders from it)
    // without marking any bytes stale.
    const renamed = song(3, { title: "novo titulo", updated_at: "2026-08-14T00:00:00Z" });
    const plan = planReconciliation(library, new Map([[3 as SongId, renamed]]));
    const touched = plan.find((p) => p.songKey === key("3"));
    expect(touched?.song).toBe(renamed);
    expect(touched?.refreshed).toBe(true);
    expect(touched?.stale).toBe(false);
  });

  it("keeps one entry per stored song, in the stored order", () => {
    const plan = planReconciliation(library, new Map([[1 as SongId, song(1)]]));
    expect(plan.map((p) => p.songKey)).toEqual([key("1"), key("2"), key("3")]);
  });

  it("ignores fresh payloads for songs that are not in the offline library", () => {
    const plan = planReconciliation(library, new Map([[42 as SongId, song(42)]]));
    expect(plan.length).toBe(3);
    expect(plan.every((p) => !p.refreshed)).toBe(true);
  });
});
