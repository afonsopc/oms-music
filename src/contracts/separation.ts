/**
 * Separation service interface (DESIGN.md 8.7; frozen contract item 12).
 * WP11 implements and registers the real service; WP7's cog and WP11's songs
 * screen compile against this today. The inert default reports "idle" and
 * refuses triggers politely.
 */
import type { SongId } from "@/domain/ids";
import type { VocalSeparation } from "@/domain/song";

export type SeparationPhase = "idle" | "pending" | "processing" | "ready" | "failed";

export interface SeparationStatus {
  phase: SeparationPhase;
  /** 0..100 while processing, else null. */
  progressPercent: number | null;
  /** Live elapsed seconds since the run started, else null. */
  elapsedSeconds: number | null;
  job: VocalSeparation | null;
}

export interface SeparationService {
  /** React hook: shared 3 s poll projection for a song id. */
  useSeparationStatus(songId: SongId): SeparationStatus;
  triggerSeparation(songId: SongId, modelId?: string): Promise<void>;
  deleteSeparation(songId: SongId): Promise<void>;
}

const idleStatus: SeparationStatus = {
  phase: "idle",
  progressPercent: null,
  elapsedSeconds: null,
  job: null,
};

const inertService: SeparationService = {
  useSeparationStatus: () => idleStatus,
  triggerSeparation: () => Promise.resolve(),
  deleteSeparation: () => Promise.resolve(),
};

let current: SeparationService = inertService;

/** WP11 (separation/register.ts) installs the real service. */
export const setSeparationService = (service: SeparationService): void => {
  current = service;
};

export const getSeparationService = (): SeparationService => current;
