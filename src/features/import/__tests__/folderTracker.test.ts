import { describe, expect, it } from "bun:test";
import {
  fileKey,
  getRecord,
  ignoreFailure,
  incompleteRecords,
  isFolderComplete,
  markFailure,
  markSuccess,
  pendingFiles,
  type ImportRecords,
} from "../folderTracker";

const file = (name: string, relativePath = "") => ({ name, relativePath });

describe("folder import resume tracker (FR-100)", () => {
  it("skips files already recorded as successes on a retry", () => {
    let records: ImportRecords = {};
    records = markSuccess(records, "Album", "a.mp3");
    const remaining = pendingFiles(getRecord(records, "Album"), [
      file("a.mp3"),
      file("b.mp3"),
    ]);
    expect(remaining.map((f) => f.name)).toEqual(["b.mp3"]);
  });

  it("keys files by relative path inside a folder, name otherwise", () => {
    expect(fileKey(file("a.mp3", "Disc 1/a.mp3"))).toBe("Disc 1/a.mp3");
    expect(fileKey(file("a.mp3"))).toBe("a.mp3");
  });

  it("a success clears a previous failure for the same file", () => {
    let records: ImportRecords = markFailure({}, "Album", "a.mp3");
    expect(incompleteRecords(records)).toHaveLength(1);
    records = markSuccess(records, "Album", "a.mp3");
    expect(records.Album!.status.failed).toEqual([]);
    expect(records.Album!.status.success).toEqual(["a.mp3"]);
    expect(incompleteRecords(records)).toHaveLength(0);
  });

  it("ignoring a failure moves it to success", () => {
    let records: ImportRecords = markFailure({}, "Album", "bad.mp3");
    records = markSuccess(records, "Album", "good.mp3");
    records = ignoreFailure(records, "Album", "bad.mp3");
    expect(records.Album!.status.failed).toEqual([]);
    expect(records.Album!.status.success).toEqual(["good.mp3", "bad.mp3"]);
  });

  it("drops the record when ignoring empties both lists", () => {
    const records = ignoreFailure({ Album: { path: "Album", status: { success: [], failed: [] } } }, "Album", "x");
    // Nothing was tracked, so the empty record disappears instead of lingering.
    expect(records.Album!.status.success).toEqual(["x"]);
  });

  it("records duplicate outcomes only once", () => {
    let records: ImportRecords = markSuccess({}, "Album", "a.mp3");
    records = markSuccess(records, "Album", "a.mp3");
    expect(records.Album!.status.success).toEqual(["a.mp3"]);
  });

  it("a folder is complete only when nothing failed and every file landed", () => {
    let records: ImportRecords = markSuccess({}, "Album", "a.mp3");
    expect(isFolderComplete(getRecord(records, "Album"), 2)).toBe(false);
    records = markSuccess(records, "Album", "b.mp3");
    expect(isFolderComplete(getRecord(records, "Album"), 2)).toBe(true);
    records = markFailure(records, "Album", "c.mp3");
    expect(isFolderComplete(getRecord(records, "Album"), 3)).toBe(false);
  });

  it("without a record every file is pending", () => {
    expect(pendingFiles(null, [file("a.mp3"), file("b.mp3")])).toHaveLength(2);
  });
});
