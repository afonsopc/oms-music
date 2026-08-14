/**
 * Pure projection of GET /songs/:id/separation into the SeparationStatus
 * contract (FR-71). No I/O, no React - bun-testable. Terminal job statuses
 * are complete|failed ONLY (no "canceled" exists server-side).
 */
import type { SeparationPhase } from "@/contracts/separation";
import type { SongSeparationStatus } from "@/domain/song";

export interface SeparationProjection {
  phase: SeparationPhase;
  /** 0..100 while a run is active, else null. */
  progressPercent: number | null;
  /** Epoch ms the current run started at (elapsed-timer base), else null. */
  startedAtMs: number | null;
}

const IDLE: SeparationProjection = {
  phase: "idle",
  progressPercent: null,
  startedAtMs: null,
};

const parseMs = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
};

export const projectSeparation = (
  data: SongSeparationStatus | null | undefined,
): SeparationProjection => {
  if (!data) return IDLE;

  const stemsPresent = !!(data.vocals_media_id && data.instrumental_media_id);
  if (data.stems_ready || stemsPresent) {
    return { phase: "ready", progressPercent: null, startedAtMs: null };
  }

  const job = data.job;
  if (!job) return IDLE;

  const startedAtMs = parseMs(job.created_at);
  const progress = data.progress_percent ?? job.progress_percent;

  switch (job.status) {
    case "pending":
      return { phase: "pending", progressPercent: progress, startedAtMs };
    case "processing":
      return { phase: "processing", progressPercent: progress, startedAtMs };
    case "complete":
      // Stems land on the Song; a complete job with no ids yet still reads
      // as ready (the songs refetch fills the ids in).
      return { phase: "ready", progressPercent: null, startedAtMs: null };
    case "failed":
      return { phase: "failed", progressPercent: null, startedAtMs: null };
    default:
      return IDLE;
  }
};

/** The 3 s poll runs ONLY while a run is active; it parks on no-job-no-stems
 *  and stops on ready/terminal (FR-71). */
export const shouldPollSeparation = (
  data: SongSeparationStatus | null | undefined,
): boolean => {
  if (!data) return false;
  const { phase } = projectSeparation(data);
  return phase === "pending" || phase === "processing";
};

export const elapsedSecondsFrom = (
  startedAtMs: number | null,
  nowMs: number,
): number | null => {
  if (startedAtMs == null) return null;
  return Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
};

/** m:ss for the live elapsed counter. */
export const formatElapsed = (totalSeconds: number): string => {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
};
