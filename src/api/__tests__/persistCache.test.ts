/**
 * O que vai para a fotografia em disco: as listas leves de sempre e, desde
 * 2026-11-04, as músicas das playlists (menos a pertença de uma música).
 */
import { describe, expect, mock, test } from "bun:test";

mock.module("@/db/kv", () => ({
  kvGet: () => null,
  kvSet: () => {},
  kvRemove: () => {},
  kvGetJson: () => null,
  kvSetJson: () => {},
}));
mock.module("@/auth/session", () => ({ registerLogoutTask: () => () => {} }));
mock.module("@/auth/lastUser", () => ({ lastUserId: () => null }));
mock.module("../queryClient", () => ({ queryClient: { getQueryCache: () => ({ subscribe: () => () => {} }) } }));

const { shouldPersist } = await import("../persistCache");

describe("shouldPersist", () => {
  test("listas leves", () => {
    expect(shouldPersist(["playlists", "list"])).toBe(true);
    expect(shouldPersist(["playEvents", "recent"])).toBe(true);
  });
  test("músicas de uma playlist, mas não a pertença", () => {
    expect(shouldPersist(["playlistSongs", 12])).toBe(true);
    expect(shouldPersist(["playlistSongs", "membership", 3])).toBe(false);
  });
  test("sem as listas de músicas quando a fotografia é grande", () => {
    expect(shouldPersist(["playlistSongs", 12], false)).toBe(false);
    expect(shouldPersist(["playlists", "list"], false)).toBe(true);
  });
  test("o resto não vai", () => expect(shouldPersist(["songs", "search", "x"])).toBe(false));
});
