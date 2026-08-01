/**
 * Presigned resolver (FR-55/60): node-id keyed cache with the 5 minute
 * reuse window, in-flight dedupe, two attempts, fresh bypass, one-shot
 * prefetch slot.
 */
import { describe, expect, it } from "bun:test";
import { toSongKey } from "@/domain/ids";
import { PresignedResolver, URL_REUSE_WINDOW_MS } from "../resolver";
import { flush } from "./fakes";

const makeClock = (start = 1_000_000) => {
  let at = start;
  return { now: () => at, advance: (ms: number) => (at += ms) };
};

describe("PresignedResolver.resolve", () => {
  it("reuses a cached URL within 5 minutes, re-resolves after", async () => {
    const clock = makeClock();
    let calls = 0;
    const r = new PresignedResolver(async () => `url-${++calls}`, clock.now);
    expect(await r.resolve("n1")).toBe("url-1");
    clock.advance(URL_REUSE_WINDOW_MS - 1);
    expect(await r.resolve("n1")).toBe("url-1"); // within the window
    clock.advance(2);
    expect(await r.resolve("n1")).toBe("url-2"); // window expired
    expect(calls).toBe(2);
  });

  it("dedupes concurrent in-flight resolves for the same node", async () => {
    let calls = 0;
    let release: (() => void) | null = null;
    const r = new PresignedResolver(async () => {
      calls++;
      await new Promise<void>((res) => {
        release = res;
      });
      return "url";
    });
    const a = r.resolve("n1");
    const b = r.resolve("n1");
    release!();
    expect(await a).toBe("url");
    expect(await b).toBe("url");
    expect(calls).toBe(1);
  });

  it("makes 2 attempts and succeeds on the second", async () => {
    let calls = 0;
    const r = new PresignedResolver(async () => {
      calls++;
      if (calls === 1) throw new Error("boom");
      return "recovered";
    });
    expect(await r.resolve("n1")).toBe("recovered");
    expect(calls).toBe(2);
  });

  it("rejects after both attempts fail", async () => {
    let calls = 0;
    const r = new PresignedResolver(async () => {
      calls++;
      throw new Error("down");
    });
    let failed = false;
    await r.resolve("n1").catch(() => {
      failed = true;
    });
    expect(failed).toBe(true);
    expect(calls).toBe(2);
  });

  it("fresh bypasses and hard-invalidates the cache", async () => {
    let calls = 0;
    const r = new PresignedResolver(async () => `url-${++calls}`);
    expect(await r.resolve("n1")).toBe("url-1");
    expect(await r.resolve("n1", { fresh: true })).toBe("url-2");
    expect(await r.resolve("n1")).toBe("url-2"); // fresh result recached
  });
});

describe("prefetch slot (one-shot)", () => {
  const key = toSongKey(7);

  it("is honored only on songKey AND nodeId match, and consumed one-shot", async () => {
    let calls = 0;
    const r = new PresignedResolver(async () => `url-${++calls}`);
    r.prefetch(key, "n1");
    await flush();
    expect(r.takePrefetched(toSongKey(8), "n1")).toBeNull(); // wrong song
    expect(r.takePrefetched(key, "n2")).toBeNull(); // wrong node
    expect(r.takePrefetched(key, "n1")).toBe("url-1");
    expect(r.takePrefetched(key, "n1")).toBeNull(); // one-shot: gone
  });

  it("expires after the 5 minute window", async () => {
    const clock = makeClock();
    const r = new PresignedResolver(async () => "url", clock.now);
    r.prefetch(key, "n1");
    await flush();
    clock.advance(URL_REUSE_WINDOW_MS + 1);
    expect(r.takePrefetched(key, "n1")).toBeNull();
  });

  it("only one in-flight prefetch per song", async () => {
    let calls = 0;
    let release: (() => void) | null = null;
    const r = new PresignedResolver(async () => {
      calls++;
      await new Promise<void>((res) => {
        release = res;
      });
      return "url";
    });
    r.prefetch(key, "n1");
    r.prefetch(key, "n1");
    expect(calls).toBe(1);
    release!();
    await flush();
    expect(r.takePrefetched(key, "n1")).toBe("url");
  });
});
