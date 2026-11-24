import { expect, test } from "bun:test";
import { changesLibrary, parseMusicNotification } from "../musicNotifications";

test("library notifications become a sentence, the rest is ignored", () => {
  const done = parseMusicNotification({ id: 1, kind: "song_import_done", context: { title: "Fado", song_id: 7 }, created_at: "x" });
  expect([done?.key, done?.tone, done?.songId, done?.params.title]).toEqual(["songAdded", "done", 7, "Fado"]);
  expect(changesLibrary(done!)).toBe(true);
  expect(parseMusicNotification({ id: 2, kind: "ticket_reply", context: {} })).toBeNull();
  expect(parseMusicNotification({ id: 2, kind: "toString", context: {} })).toBeNull();
  expect(parseMusicNotification(null)).toBeNull();
});

test("an address is never shown as a title", () => {
  const failed = parseMusicNotification({ id: 3, kind: "song_import_failed", context: { title: "https://example.com/x" } });
  expect([failed?.key, failed?.tone, failed?.songId]).toEqual(["songFailedUntitled", "failed", null]);
  expect(changesLibrary(failed!)).toBe(false);
});
