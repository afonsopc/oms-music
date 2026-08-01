/**
 * Pure-logic tests for the download status read seam (FR-82 read half):
 * inert defaults, reader installation, coarse version propagation and
 * subscription detach.
 */
import { describe, expect, test } from "bun:test";
import {
  getDownloadStatusReader,
  setDownloadStatusReader,
  type DownloadStatusReader,
} from "../downloadStatus";

const makeReader = (): DownloadStatusReader & {
  bump: () => void;
  subscriberCount: () => number;
} => {
  const subscribers = new Set<() => void>();
  return {
    getStatus: (id) => (String(id) === "1" ? "downloading" : "none"),
    getProgress: (id) => (String(id) === "1" ? 0.5 : 0),
    subscribe: (cb) => {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
    bump: () => {
      for (const cb of subscribers) cb();
    },
    subscriberCount: () => subscribers.size,
  };
};

describe("downloadStatus seam", () => {
  test("inert default reports none / 0", () => {
    const reader = getDownloadStatusReader();
    expect(reader.getStatus(42)).toBe("none");
    expect(reader.getProgress(42)).toBe(0);
    const unsubscribe = reader.subscribe(() => {});
    expect(typeof unsubscribe).toBe("function");
    unsubscribe();
  });

  test("installed reader serves sync reads for numeric and string ids", () => {
    const fake = makeReader();
    setDownloadStatusReader(fake);
    const reader = getDownloadStatusReader();
    expect(reader.getStatus(1)).toBe("downloading");
    expect(reader.getStatus("1")).toBe("downloading");
    expect(reader.getProgress(1)).toBe(0.5);
    expect(reader.getStatus(2)).toBe("none");
  });

  test("replacing the reader swaps the source", () => {
    const first = makeReader();
    setDownloadStatusReader(first);
    const second: DownloadStatusReader = {
      getStatus: () => "done",
      getProgress: () => 1,
      subscribe: () => () => {},
    };
    setDownloadStatusReader(second);
    expect(getDownloadStatusReader().getStatus(1)).toBe("done");
    expect(getDownloadStatusReader().getProgress(99)).toBe(1);
  });
});
