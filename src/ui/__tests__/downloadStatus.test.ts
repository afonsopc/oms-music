/**
 * Pure-logic tests for the download status read seam (FR-82 read half):
 * inert defaults, reader installation, coarse version propagation and
 * subscription detach.
 */
import { describe, expect, test } from "bun:test";
import {
  getDownloadStatusReader,
  setDownloadStatusReader,
  summarizeDownloads,
  type DownloadStatusReader,
} from "../downloadStatus";
import type { SongDownloadStatus } from "@/domain/downloads";

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

describe("summarizeDownloads (collection X de Y)", () => {
  const byId: Record<string, SongDownloadStatus> = {
    "1": "done",
    "2": "queued",
    "3": "downloading",
    "4": "error",
    "5": "none",
  };
  const read = { getStatus: (id: number | string) => byId[String(id)] ?? "none" };

  test("counts done, pending (queued + downloading) and error", () => {
    expect(summarizeDownloads([1, 2, 3, 4, 5], read)).toEqual({
      total: 5,
      done: 1,
      pending: 2,
      error: 1,
    });
  });

  test("numeric and string ids hit the same reader keys", () => {
    expect(summarizeDownloads(["1", 2, "3"], read)).toEqual({
      total: 3,
      done: 1,
      pending: 2,
      error: 0,
    });
  });

  test("defaults to the installed reader", () => {
    setDownloadStatusReader({
      getStatus: () => "done",
      getProgress: () => 1,
      subscribe: () => () => {},
    });
    expect(summarizeDownloads([7, 8])).toEqual({ total: 2, done: 2, pending: 0, error: 0 });
    expect(summarizeDownloads([])).toEqual({ total: 0, done: 0, pending: 0, error: 0 });
  });
});
