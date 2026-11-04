import { afterEach, describe, expect, it } from "bun:test";
import type { Job } from "@/domain/lyrics";
import { awaitJob, jobFromCableMessage, setJobChannelWatcher, syncOutcome } from "../syncJob";

const job = (over: Partial<Job>): Job => ({
  id: "job-1",
  job_type: "lyrics_sync",
  payload: {},
  status: "pending",
  progress: null,
  started_at: null,
  finished_at: null,
  result: null,
  error: null,
  creator_id: "user-1" as Job["creator_id"],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...over,
});

afterEach(() => {
  setJobChannelWatcher(null);
});

describe("jobFromCableMessage (JobChannel payloads)", () => {
  it("extracts { job } payloads", () => {
    const payload = job({ status: "processing" });
    expect(jobFromCableMessage({ job: payload })).toEqual(payload);
  });

  it("ignores anything that is not a job envelope", () => {
    expect(jobFromCableMessage(null)).toBeNull();
    expect(jobFromCableMessage("ping")).toBeNull();
    expect(jobFromCableMessage({})).toBeNull();
    expect(jobFromCableMessage({ job: null })).toBeNull();
    expect(jobFromCableMessage({ job: { status: "complete" } })).toBeNull();
  });
});

// The watchers below answer synchronously, so the awaits settle before the
// REST poll fallback ever loads (and never touch the network).
describe("awaitJob (FR-80 channel fast path)", () => {
  it("resolves with the first job that has finished_at set", async () => {
    const finished = job({ status: "complete", finished_at: "2026-01-01T00:01:00Z" });
    setJobChannelWatcher((_id, onJob) => {
      // Snapshot + progress updates first: neither is terminal.
      onJob(job({ status: "pending" }));
      onJob(job({ status: "processing", progress: 40 }));
      onJob(finished);
      return () => {};
    });
    expect(await awaitJob("job-1")).toEqual(finished);
  });

  it("stops a watcher that answered synchronously", async () => {
    let stopped = false;
    setJobChannelWatcher((_id, onJob) => {
      onJob(job({ status: "failed", finished_at: "2026-01-01T00:01:00Z" }));
      return () => {
        stopped = true;
      };
    });
    const terminal = await awaitJob("job-1");
    expect(terminal.status).toBe("failed");
    expect(stopped).toBe(true);
  });

  it("rejects when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    setJobChannelWatcher(() => () => {});
    let message: string | null = null;
    try {
      await awaitJob("job-1", { signal: controller.signal });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe("aborted");
  });
});

describe("syncOutcome", () => {
  const job = (over: Partial<Job>): Job =>
    ({ id: "j", status: "failed", result: null, error: null, finished_at: "x", ...over }) as Job;

  it("reads the reason the server put in the error", () => {
    expect(syncOutcome(job({ error: "[no_match] Não deu para acertar esta letra" }))).toBe("no_match");
    expect(syncOutcome(job({ error: "[busy] Os transcritores estão ocupados" }))).toBe("busy");
    expect(syncOutcome(job({ error: "RuntimeError" }))).toBe("failed");
  });

  it("tells lyrics written without timing apart from a full sync", () => {
    expect(syncOutcome(job({ status: "complete", result: { unsynced: true } }))).toBe("unsynced");
    expect(syncOutcome(job({ status: "complete", result: { synced_lines: 12 } }))).toBe("ok");
  });
});
