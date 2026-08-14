/**
 * Transfer engine (FR-84): a JS scheduler (3 concurrent) over the
 * expo-file-system task API. Source URLs are `/media/:id/data?token=`
 * built at DEQUEUE time (redirect-following, rate-exempt, never expires);
 * NO Authorization header is attached - S3 rejects requests carrying both
 * header auth and a presigned query signature after the 302 hop.
 *
 * Savables: `DownloadTask.savable()` only works on paused tasks, so the
 * scheduler synthesizes the same `DownloadPauseState` shape at task start
 * and hands it to the manager for row persistence; on boot the manager
 * re-attaches via `DownloadTask.fromSavable()` + `resumeAsync()`, and an
 * unresumable savable falls back to a fresh download of the same node.
 */
import { DownloadTask, File, type DownloadPauseState } from "expo-file-system";
import { downloadUrl } from "@/api/mediaUrl";
import type { DownloadKind } from "@/domain/downloads";
import type { FsNodeId, SongKey } from "@/domain/ids";

export const TRANSFER_CONCURRENCY = 3;

export interface TransferRequest {
  songKey: SongKey;
  kind: DownloadKind;
  nodeId: FsNodeId;
  /** Absolute file:// destination with the real extension. */
  destUri: string;
}

export interface TransferEvents {
  /** Fired when the native task starts; persist the savable on the row. */
  onStarted(req: TransferRequest, savableJson: string): void;
  onProgress(req: TransferRequest, progress: number): void;
  onComplete(req: TransferRequest, file: File): void;
  onError(req: TransferRequest, message: string): void;
  onCancelled(req: TransferRequest): void;
}

interface QueueEntry {
  req: TransferRequest;
  /** Persisted pause state from a previous launch (re-attach path). */
  savedState: DownloadPauseState | null;
}

interface RunningEntry {
  req: TransferRequest;
  task: DownloadTask | null;
  abort: AbortController;
}

const entryKey = (songKey: SongKey, kind: DownloadKind): string => `${songKey}::${kind}`;

export class TransferScheduler {
  private queue: QueueEntry[] = [];
  private running = new Map<string, RunningEntry>();

  constructor(
    private events: TransferEvents,
    private concurrency: number = TRANSFER_CONCURRENCY,
  ) {}

  /** True when the (song, kind) transfer is queued or running here. */
  has(songKey: SongKey, kind: DownloadKind): boolean {
    const key = entryKey(songKey, kind);
    if (this.running.has(key)) return true;
    return this.queue.some((e) => entryKey(e.req.songKey, e.req.kind) === key);
  }

  /** Idempotent enqueue; a fresh URL is minted when the task starts. */
  enqueue(req: TransferRequest): void {
    if (this.has(req.songKey, req.kind)) return;
    this.queue.push({ req, savedState: null });
    this.pump();
  }

  /** Boot re-attach of a persisted savable (FR-84). */
  reattach(req: TransferRequest, savableJson: string): void {
    if (this.has(req.songKey, req.kind)) return;
    let savedState: DownloadPauseState | null = null;
    try {
      savedState = JSON.parse(savableJson) as DownloadPauseState;
    } catch {
      savedState = null; // Corrupt savable: fall back to a fresh download.
    }
    this.queue.push({ req, savedState });
    this.pump();
  }

  cancelSong(songKey: SongKey): void {
    this.queue = this.queue.filter((e) => {
      if (e.req.songKey !== songKey) return true;
      this.events.onCancelled(e.req);
      return false;
    });
    for (const entry of this.running.values()) {
      if (entry.req.songKey === songKey) entry.abort.abort();
    }
  }

  cancelAll(): void {
    const dropped = this.queue;
    this.queue = [];
    for (const e of dropped) this.events.onCancelled(e.req);
    for (const entry of this.running.values()) entry.abort.abort();
  }

  get inFlightCount(): number {
    return this.queue.length + this.running.size;
  }

  private pump(): void {
    while (this.running.size < this.concurrency && this.queue.length > 0) {
      const entry = this.queue.shift()!;
      void this.start(entry);
    }
  }

  private async start(entry: QueueEntry): Promise<void> {
    const { req } = entry;
    const key = entryKey(req.songKey, req.kind);
    const abort = new AbortController();
    const running: RunningEntry = { req, task: null, abort };
    this.running.set(key, running);

    const onProgress = ({
      bytesWritten,
      totalBytes,
    }: {
      bytesWritten: number;
      totalBytes: number;
    }): void => {
      const progress = totalBytes > 0 ? Math.min(1, bytesWritten / totalBytes) : 0;
      this.events.onProgress(req, progress);
    };

    const finish = (): void => {
      this.running.delete(key);
      running.task?.release();
      this.pump();
    };

    try {
      let file: File | null = null;
      let resumed = false;

      if (entry.savedState) {
        // Re-attach path: resume from the persisted pause state.
        try {
          const task = DownloadTask.fromSavable(entry.savedState, {
            sessionType: "background",
            onProgress,
            signal: abort.signal,
          });
          running.task = task;
          this.events.onStarted(req, JSON.stringify(entry.savedState));
          file = await task.resumeAsync();
          resumed = true;
        } catch (error) {
          if (isAbort(error)) {
            this.events.onCancelled(req);
            finish();
            return;
          }
          // Unresumable savable (expired token/resume data): drop it and
          // fall through to a fresh download of the same node.
          running.task?.release();
          running.task = null;
        }
      }

      if (!resumed) {
        file = await this.freshDownload(running, onProgress);
      }

      if (file) {
        this.events.onComplete(req, file);
      } else if (running.task) {
        // Paused before completion (should not happen: we never pause).
        // Persist the real savable so the next boot resumes it.
        try {
          this.events.onStarted(req, JSON.stringify(running.task.savable()));
        } catch {
          // Not in a savable state; repair re-enqueues on next boot.
        }
      }
      finish();
    } catch (error) {
      finish();
      if (isAbort(error)) {
        this.events.onCancelled(req);
      } else {
        this.events.onError(req, error instanceof Error ? error.message : String(error));
      }
    }
  }

  private async freshDownload(
    running: RunningEntry,
    onProgress: (data: { bytesWritten: number; totalBytes: number }) => void,
  ): Promise<File | null> {
    const { req, abort } = running;
    const dest = new File(req.destUri);
    try {
      if (dest.exists) dest.delete(); // Stale partial from a previous run.
    } catch {
      // Deletion failure surfaces as a download error below.
    }
    const url = downloadUrl(req.nodeId); // DEQUEUE-time URL (fresh token).
    const task = File.createDownloadTask(url, dest, {
      sessionType: "background",
      onProgress,
      signal: abort.signal,
    });
    running.task = task;
    // Synthesized savable persisted on task create (savable() needs paused).
    const savable: DownloadPauseState = {
      url,
      fileUri: req.destUri,
      isDirectory: false,
    };
    this.events.onStarted(req, JSON.stringify(savable));
    return task.downloadAsync();
  }
}

const isAbort = (error: unknown): boolean =>
  error instanceof Error && error.name === "AbortError";
