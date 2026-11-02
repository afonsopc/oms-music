import { describe, expect, it } from "bun:test";
import { MUSIC_CABLE_PATH, SHARED_CABLE_PATH, cablePathFor, cableUrl } from "../routes";

describe("cable routing", () => {
  it("music channels ride the music app's own cable, the rest the omelhorsite's", () => {
    for (const channel of ["PlaybackChannel", "JamChannel", "FriendListeningChannel"]) {
      expect(cablePathFor({ channel })).toBe(MUSIC_CABLE_PATH);
    }
    expect(cablePathFor({ channel: "NotificationsChannel" })).toBe(SHARED_CABLE_PATH);
    expect(cablePathFor({ channel: "JobChannel", id: "j" })).toBe(SHARED_CABLE_PATH);
  });

  it("builds the urls with the token or for the cookie", () => {
    const base = "https://backend.omelhorsite.pt";
    expect(cableUrl(base, MUSIC_CABLE_PATH, "")).toBe("wss://backend.omelhorsite.pt/music/cable");
    expect(cableUrl(base, MUSIC_CABLE_PATH, "t 1")).toBe("wss://backend.omelhorsite.pt/music/cable?token=t%201");
    expect(cableUrl("http://localhost:1143", SHARED_CABLE_PATH, "t")).toBe("ws://localhost:1143/cable?token=t");
  });
});
