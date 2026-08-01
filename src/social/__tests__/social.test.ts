import { describe, expect, it } from "bun:test";
import type { UserId } from "@/domain/ids";
import type { FriendListening } from "@/domain/social";
import { artistNamesLine, formatSnapshotDuration, musicProfileArtistImage } from "../display";
import {
  hasListeningRows,
  sortFriendListening,
  upsertFriendListening,
} from "../listeningStore";
import { parseJamInvite } from "../notifications";

const row = (over: Partial<FriendListening> & { id: string }): FriendListening => ({
  user: { id: over.id as UserId, handle: over.id, name: over.id },
  song: null,
  paused: false,
  online: false,
  jam_id: null,
  updated_at: null,
  ...over,
});

const song = (title: string) =>
  ({
    id: "1",
    title,
    album: null,
    duration: 100,
    owner_id: "u" as UserId,
    artist_names: "A, B",
    artwork_url: null,
  }) as unknown as FriendListening["song"];

describe("friends feed ordering (FR-119)", () => {
  it("puts live rows first, then the most recently updated", () => {
    const rows = [
      row({ id: "old", updated_at: "2026-01-01T00:00:00Z" }),
      row({ id: "live", online: true, paused: false, song: song("x"), updated_at: null }),
      row({ id: "new", updated_at: "2026-06-01T00:00:00Z" }),
    ];
    expect(sortFriendListening(rows).map((r) => r.user.id)).toEqual(["live", "new", "old"]);
  });

  it("does not count a paused or offline listener as live", () => {
    const rows = [
      row({ id: "paused", online: true, paused: true, song: song("x") }),
      row({ id: "offline", online: false, paused: false, song: song("x") }),
      row({
        id: "live",
        online: true,
        paused: false,
        song: song("x"),
        updated_at: "2020-01-01T00:00:00Z",
      }),
    ];
    expect(sortFriendListening(rows)[0].user.id).toBe("live");
  });

  it("replaces a row wholesale by user id and appends unknown users", () => {
    const initial = [row({ id: "a", updated_at: "2026-01-01T00:00:00Z" })];
    const replaced = upsertFriendListening(initial, row({ id: "a", song: song("new") }));
    expect(replaced).toHaveLength(1);
    expect(replaced[0].song?.title).toBe("new");

    const appended = upsertFriendListening(replaced, row({ id: "b" }));
    expect(appended.map((r) => r.user.id).sort()).toEqual(["a", "b"]);
  });

  it("keeps sharing-off friends as presence rows, but not as strip content", () => {
    const rows = [row({ id: "quiet", online: true })];
    expect(rows).toHaveLength(1);
    expect(hasListeningRows(rows)).toBeFalsy();
    expect(hasListeningRows([...rows, row({ id: "loud", song: song("x") })])).toBeTruthy();
  });
});

describe("cross-user display helpers", () => {
  it("accepts the comma-joined artist_names the backend actually sends", () => {
    expect(artistNamesLine("Carlos Paiao, Xutos")).toBe("Carlos Paiao, Xutos");
  });

  it("also accepts the array the frozen domain type declares", () => {
    expect(artistNamesLine(["Carlos Paiao", "Xutos"])).toBe("Carlos Paiao, Xutos");
    expect(artistNamesLine(null)).toBe("");
    expect(artistNamesLine(undefined)).toBe("");
  });

  it("formats snapshot durations defensively", () => {
    expect(formatSnapshotDuration(65)).toBe("1:05");
    expect(formatSnapshotDuration(Number.NaN)).toBe("0:00");
    expect(formatSnapshotDuration(-4)).toBe("0:00");
  });

  it("picks profile artist images in the frozen order (FR-120)", () => {
    expect(
      musicProfileArtistImage({
        image_url: "upload",
        picture_big: "big",
        picture_xl: "xl",
      }),
    ).toBe("upload");
    expect(musicProfileArtistImage({ picture_big: "big", picture_xl: "xl" })).toBe("big");
    expect(musicProfileArtistImage({ picture_xl: "xl", picture_medium: "med" })).toBe("xl");
    expect(musicProfileArtistImage({ external_image_url: "ext" })).toBe("ext");
    expect(musicProfileArtistImage({})).toBeNull();
  });
});

describe("jam invite notifications (FR-118)", () => {
  it("parses a jam_invite context", () => {
    const invite = parseJamInvite({
      kind: "jam_invite",
      context: {
        jam_id: 12,
        host_id: "u_host",
        host_handle: "host",
        inviter_id: "u_inv",
        inviter_handle: "inv",
      },
    });
    expect(invite?.jamId).toBe(12);
    expect(invite?.inviterHandle).toBe("inv");
  });

  it("ignores every other notification kind and malformed contexts", () => {
    expect(parseJamInvite({ kind: "friend_request", context: { jam_id: 1 } })).toBeNull();
    expect(parseJamInvite({ kind: "jam_invite" })).toBeNull();
    expect(parseJamInvite({ kind: "jam_invite", context: { jam_id: "nope" } })).toBeNull();
    expect(parseJamInvite(null)).toBeNull();
  });
});
