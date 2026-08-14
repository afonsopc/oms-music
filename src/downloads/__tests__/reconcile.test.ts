/**
 * Media-id reconciliation. This is the comparison that decides whether cached
 * bytes are the RIGHT bytes, so a false negative means a re-transcoded song
 * plays its old master forever and a false positive means we throw away a
 * perfectly good file (and re-download it) on every repair pass.
 */
import { describe, expect, it } from "bun:test";
import type { DownloadKind } from "@/domain/downloads";
import type { FsNodeId, SongId, SongKey } from "@/domain/ids";
import type { Song } from "@/domain/song";
import {
  hasMediaIdFields,
  isStaleForNode,
  mediaIdsChanged,
  planReconciliation,
  staleKinds,
  wantedNodes,
} from "../reconcile";

const song = (over: Partial<Song> = {}): Song =>
  ({
    id: 1 as SongId,
    title: "t",
    updated_at: "2026-01-01T00:00:00Z",
    audio_media_id: null,
    compressed_audio_media_id: null,
    artwork_media_id: null,
    compressed_artwork_media_id: null,
    vocals_media_id: null,
    instrumental_media_id: null,
    ...over,
  }) as Song;

const node = (v: string): FsNodeId => v as FsNodeId;
const row = (kind: DownloadKind, nodeId: string, status = "done") => ({
  kind,
  node_id: nodeId,
  status,
});

describe("isStaleForNode", () => {
  it("is false for a missing row: there are no bytes to be wrong about", () => {
    expect(isStaleForNode(null, "10")).toBe(false);
  });

  it("is false for a queued row, whatever its node id", () => {
    expect(isStaleForNode({ node_id: "9", status: "queued" }, "10")).toBe(false);
    expect(isStaleForNode({ node_id: "9", status: "downloading" }, "10")).toBe(false);
    expect(isStaleForNode({ node_id: "9", status: "error" }, "10")).toBe(false);
  });

  it("is false for a done row holding the id we want", () => {
    expect(isStaleForNode({ node_id: "10", status: "done" }, "10")).toBe(false);
  });

  it("is true for a done row holding a DIFFERENT id", () => {
    expect(isStaleForNode({ node_id: "9", status: "done" }, "10")).toBe(true);
  });
});

describe("hasMediaIdFields", () => {
  it("accepts a payload that serializes the ids, nulls included", () => {
    expect(hasMediaIdFields(song())).toBe(true);
  });

  it("rejects a trimmed list row whose attachment fields are simply absent", () => {
    // The failure this pins: `extractSongs` casts anything with a numeric id
    // to Song, so a list endpoint that omits attachments would otherwise be
    // read as "the server dropped them" and the repair pass would replace a
    // perfectly good downloaded file on every run.
    const trimmed = { id: 1, title: "t", updated_at: "x" } as unknown as Song;
    expect(hasMediaIdFields(trimmed)).toBe(false);
    // And therefore nothing is ever called stale on its account.
    expect(mediaIdsChanged(song({ compressed_audio_media_id: node("2") }), trimmed)).toBe(true);
    expect(staleKinds(trimmed, [row("mixed", "2")])).toEqual([]);
  });
});

describe("wantedNodes", () => {
  it("prefers the compressed transcode for the mix", () => {
    expect(
      wantedNodes(song({ audio_media_id: node("1"), compressed_audio_media_id: node("2") })),
    ).toEqual({ mixed: node("2"), mixed_original: node("1") });
  });

  it("falls back to the master when there is no transcode", () => {
    const wanted = wantedNodes(song({ audio_media_id: node("1") }));
    expect(wanted.mixed).toBe(node("1"));
    // Mirrors downloadSong exactly, quirk included: with no transcode the
    // master is enqueued under BOTH kinds. Diverging here would make the
    // repair pass call a perfectly good mixed_original row stale.
    expect(wanted.mixed_original).toBe(node("1"));
  });

  it("omits mixed_original when the two ids are the same", () => {
    const wanted = wantedNodes(
      song({ audio_media_id: node("5"), compressed_audio_media_id: node("5") }),
    );
    expect(wanted.mixed).toBe(node("5"));
    expect(wanted.mixed_original).toBeUndefined();
  });

  it("prefers the compressed cover and lists both stems", () => {
    expect(
      wantedNodes(
        song({
          artwork_media_id: node("3"),
          compressed_artwork_media_id: node("4"),
          vocals_media_id: node("6"),
          instrumental_media_id: node("7"),
        }),
      ),
    ).toEqual({ artwork: node("4"), vocal: node("6"), instrumental: node("7") });
  });

  it("wants nothing from a payload with no media at all", () => {
    expect(wantedNodes(song())).toEqual({});
  });
});

describe("mediaIdsChanged", () => {
  const base = song({ compressed_audio_media_id: node("2"), artwork_media_id: node("3") });

  it("is false for the same ids, even with a different updated_at", () => {
    expect(mediaIdsChanged(base, song({ ...base, updated_at: "2026-09-09T00:00:00Z" }))).toBe(
      false,
    );
  });

  it("catches a re-transcode (new audio id, same updated_at)", () => {
    expect(mediaIdsChanged(base, song({ ...base, compressed_audio_media_id: node("22") }))).toBe(
      true,
    );
  });

  it("catches a replaced cover", () => {
    expect(mediaIdsChanged(base, song({ ...base, artwork_media_id: node("33") }))).toBe(true);
  });

  it("catches stems appearing where there were none", () => {
    expect(mediaIdsChanged(base, song({ ...base, vocals_media_id: node("6") }))).toBe(true);
  });
});

describe("staleKinds", () => {
  const current = song({
    compressed_audio_media_id: node("2"),
    audio_media_id: node("1"),
    compressed_artwork_media_id: node("4"),
    vocals_media_id: node("6"),
  });

  it("finds only the rows holding the wrong bytes", () => {
    expect(
      staleKinds(current, [
        row("mixed", "OLD"),
        row("mixed_original", "1"),
        row("artwork", "4"),
        row("vocal", "OLD"),
      ]),
    ).toEqual(["mixed", "vocal"]);
  });

  it("ignores rows that are not done", () => {
    expect(staleKinds(current, [row("mixed", "OLD", "queued")])).toEqual([]);
  });

  it("ignores a kind the payload no longer wants at all", () => {
    // The server dropped the instrumental stem: the file is extra, not wrong,
    // and removeDownload is what clears extras.
    expect(staleKinds(current, [row("instrumental", "77")])).toEqual([]);
  });

  it("returns nothing for a fully matching set", () => {
    expect(
      staleKinds(current, [row("mixed", "2"), row("artwork", "4"), row("vocal", "6")]),
    ).toEqual([]);
  });
});

describe("planReconciliation", () => {
  const key = (v: string): SongKey => v as SongKey;
  const stored = song({ id: 7 as SongId, compressed_audio_media_id: node("2") });

  it("keeps the stored payload when the cache has nothing fresher", () => {
    const plan = planReconciliation([{ songKey: key("7"), song: stored }], new Map());
    expect(plan).toEqual([
      { songKey: key("7"), song: stored, stale: false, refreshed: false },
    ]);
  });

  it("prefers the fresh payload and flags the media-id change", () => {
    const fresh = song({ id: 7 as SongId, compressed_audio_media_id: node("99") });
    const plan = planReconciliation(
      [{ songKey: key("7"), song: stored }],
      new Map([[7 as SongId, fresh]]),
    );
    expect(plan[0]?.song).toBe(fresh);
    expect(plan[0]?.stale).toBe(true);
    expect(plan[0]?.refreshed).toBe(true);
  });

  it("prefers the fresh payload WITHOUT flagging when the bytes are the same", () => {
    const fresh = song({ ...stored, title: "renamed" });
    const plan = planReconciliation(
      [{ songKey: key("7"), song: stored }],
      new Map([[7 as SongId, fresh]]),
    );
    expect(plan[0]?.song).toBe(fresh);
    expect(plan[0]?.stale).toBe(false);
    expect(plan[0]?.refreshed).toBe(true);
  });
});
