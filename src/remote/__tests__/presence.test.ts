import { describe, expect, it } from "bun:test";
import type { PlaybackDevice } from "@/domain/playback";
import {
  devicePresence,
  GONE_PRESENCE_MS,
  presenceAnchorMs,
  STALE_PRESENCE_MS,
} from "../presence";

// Server timestamps deliberately far from the machine's real clock: presence
// must never compare `last_seen_at` against Date.now() (a skewed client
// clock would dim every row), only against the frame's own anchor.
const SERVER_NOW = Date.parse("2020-01-01T12:00:00.000Z");

const device = (over: Partial<PlaybackDevice> = {}): PlaybackDevice => ({
  id: "sess:x",
  label: "Pixel",
  device_type: "mobile",
  online: true,
  last_seen_at: new Date(SERVER_NOW).toISOString(),
  ...over,
});

const seenAgo = (ms: number): string => new Date(SERVER_NOW - ms).toISOString();

describe("presenceAnchorMs", () => {
  it("anchors on the freshest ONLINE heartbeat and ignores offline recents", () => {
    const anchor = presenceAnchorMs([
      device({ last_seen_at: seenAgo(30_000) }),
      device({ id: "sess:y" }),
      device({ id: "old", online: false, last_seen_at: new Date(SERVER_NOW + 9e6).toISOString() }),
    ]);
    expect(anchor).toBe(SERVER_NOW);
  });

  it("is null when nothing online carries a timestamp", () => {
    expect(presenceAnchorMs([device({ last_seen_at: undefined })])).toBeNull();
    expect(presenceAnchorMs([])).toBeNull();
  });
});

describe("devicePresence", () => {
  const anchor = SERVER_NOW;

  it("keeps a freshly-heartbeated row fresh regardless of the client clock", () => {
    expect(devicePresence(device(), anchor, 0)).toEqual({ kind: "fresh" });
    expect(devicePresence(device({ last_seen_at: seenAgo(60_000) }), anchor, 0)).toEqual({
      kind: "fresh",
    });
  });

  it("dims a ghost row left behind by a relaunch", () => {
    const ghost = device({ id: "sess:old", last_seen_at: seenAgo(2 * 60_000) });
    expect(devicePresence(ghost, anchor, 0)).toEqual({ kind: "stale", minutes: 2 });
  });

  it("adds the roster's own age on the client clock", () => {
    // 30 s behind the anchor at frame time + a 70 s old frame = 100 s dead.
    const row = device({ last_seen_at: seenAgo(30_000) });
    expect(devicePresence(row, anchor, 70_000)).toEqual({ kind: "stale", minutes: 1 });
    expect(devicePresence(row, anchor, STALE_PRESENCE_MS - 30_001)).toEqual({ kind: "fresh" });
  });

  it("hides a row dead for long enough", () => {
    const ghost = device({ last_seen_at: seenAgo(GONE_PRESENCE_MS) });
    expect(devicePresence(ghost, anchor, 0)).toEqual({ kind: "gone" });
  });

  it("trusts `online` as-is when timestamps are missing or unparseable", () => {
    expect(devicePresence(device({ last_seen_at: undefined }), anchor, 9e9)).toEqual({
      kind: "fresh",
    });
    expect(devicePresence(device({ last_seen_at: "not-a-date" }), anchor, 9e9)).toEqual({
      kind: "fresh",
    });
    expect(devicePresence(device(), null, 9e9)).toEqual({ kind: "fresh" });
  });
});
