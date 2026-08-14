/**
 * The inert `DownloadsSurface` is not a placeholder: it is the PERMANENT,
 * correct implementation for a plain browser tab, and the settings screens
 * render against it there. So this test pins the exact shape of "nothing",
 * because a screen that reads `undefined.bytes` on music.omelhorsite.pt is a
 * crash on the one platform with no downloads to debug it with.
 */
import { describe, expect, it } from "bun:test";
import {
  getDownloadsSurface,
  getInertDownloadsSurface,
  setDownloadsSurface,
  type DownloadsSurface,
} from "../surface";

describe("downloads surface", () => {
  it("answers zeros and empty arrays before anything installs one", async () => {
    const surface = getInertDownloadsSurface();
    expect(surface.available()).toBe(false);
    expect(surface.listDownloadedSongs()).toEqual([]);
    expect(surface.downloadedPlaylists()).toEqual([]);
    expect(surface.listInFlight()).toEqual([]);
    expect(surface.pinnedUsage()).toEqual({ bytes: 0, files: 0 });
    expect(surface.evictableUsage()).toEqual({ bytes: 0, files: 0 });
    expect(await surface.storageUsageSlow()).toEqual({ bytes: 0, files: 0 });
  });

  it("never rejects from the inert download and remove paths", async () => {
    const surface = getInertDownloadsSurface();
    // Call sites are `void surface.download(song)`; a rejection there would be
    // an unhandled promise on a platform that has no downloads at all.
    await expect(
      surface.download({ id: 1 } as unknown as Parameters<DownloadsSurface["download"]>[0]),
    ).resolves.toBeUndefined();
    await expect(surface.remove(1)).resolves.toBeUndefined();
  });

  it("is the default, and an install replaces it", () => {
    expect(getDownloadsSurface()).toBe(getInertDownloadsSurface());
    const stub: DownloadsSurface = {
      ...getInertDownloadsSurface(),
      available: () => true,
      pinnedUsage: () => ({ bytes: 42, files: 1 }),
    };
    setDownloadsSurface(stub);
    expect(getDownloadsSurface().available()).toBe(true);
    expect(getDownloadsSurface().pinnedUsage()).toEqual({ bytes: 42, files: 1 });
    setDownloadsSurface(getInertDownloadsSurface());
    expect(getDownloadsSurface()).toBe(getInertDownloadsSurface());
  });
});
