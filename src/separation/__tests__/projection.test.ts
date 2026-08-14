import { describe, expect, it } from "bun:test";
import {
  elapsedSecondsFrom,
  formatElapsed,
  projectSeparation,
  shouldPollSeparation,
} from "../projection";
import type { SongSeparationStatus, VocalSeparation } from "@/domain/song";

const job = (overrides: Partial<VocalSeparation> = {}): VocalSeparation =>
  ({
    id: "vs1",
    created_at: "2026-08-01T10:00:00Z",
    updated_at: "2026-08-01T10:00:00Z",
    status: "processing",
    model_id: "bs_roformer",
    duration_seconds: null,
    error: null,
    finished_at: null,
    song_id: 1,
    user_id: "u1",
    progress_percent: 40,
    ...overrides,
  }) as VocalSeparation;

const status = (overrides: Partial<SongSeparationStatus> = {}): SongSeparationStatus => ({
  stems_ready: false,
  vocals_media_id: null,
  instrumental_media_id: null,
  progress_percent: null,
  job: null,
  ...overrides,
});

describe("separation projection (FR-71)", () => {
  it("parks on no job and no stems", () => {
    expect(projectSeparation(status()).phase).toBe("idle");
    expect(shouldPollSeparation(status())).toBe(false);
    expect(shouldPollSeparation(undefined)).toBe(false);
  });

  it("polls while pending or processing", () => {
    expect(shouldPollSeparation(status({ job: job({ status: "pending" }) }))).toBe(true);
    expect(shouldPollSeparation(status({ job: job({ status: "processing" }) }))).toBe(true);
  });

  it("reports ready when the stems landed and stops polling", () => {
    const ready = status({
      stems_ready: true,
      vocals_media_id: "v",
      instrumental_media_id: "i",
      job: job({ status: "complete" }),
    });
    expect(projectSeparation(ready).phase).toBe("ready");
    expect(shouldPollSeparation(ready)).toBe(false);
  });

  it("terminal statuses are complete|failed only - there is no canceled", () => {
    expect(projectSeparation(status({ job: job({ status: "complete" }) })).phase).toBe("ready");
    const failed = status({ job: job({ status: "failed" }) });
    expect(projectSeparation(failed).phase).toBe("failed");
    expect(shouldPollSeparation(failed)).toBe(false);
  });

  it("carries the live progress percent while running", () => {
    const running = status({ progress_percent: 66, job: job({ status: "processing" }) });
    expect(projectSeparation(running).progressPercent).toBe(66);
  });

  it("bases the elapsed timer on the job creation time", () => {
    const started = Date.parse("2026-08-01T10:00:00Z");
    expect(elapsedSecondsFrom(started, started + 95_000)).toBe(95);
    expect(elapsedSecondsFrom(null, started)).toBeNull();
    expect(formatElapsed(95)).toBe("1:35");
    expect(formatElapsed(-4)).toBe("0:00");
  });
});
