/**
 * The account notifications that are about the music library: songs that came
 * in (or failed to), and vocal separations. They arrive on the same
 * NotificationsChannel as everything else of the account; the rest is ignored.
 * No service names here: this file ships in the native apps.
 */
export type MusicNotificationTone = "done" | "failed";

export interface MusicNotification {
  id: number;
  kind: string;
  tone: MusicNotificationTone;
  /** i18n key under native.notifications, and its params. */
  key: string;
  params: Record<string, string | number>;
  songId: number | null;
  createdAt: string;
  read: boolean;
}

const KINDS: Readonly<Record<string, { key: string; tone: MusicNotificationTone }>> = {
  song_import_done: { key: "songAdded", tone: "done" },
  song_import_failed: { key: "songFailed", tone: "failed" },
  artist_import_done: { key: "artistAdded", tone: "done" },
  vocal_separation_done: { key: "separationDone", tone: "done" },
  vocal_separation_failed: { key: "separationFailed", tone: "failed" },
};

/** A linked account's playlists, whatever the service: `<service>_sync_done`. */
const SYNC_KIND = /_sync_(done|failed)$/;

const describeKind = (kind: string): { key: string; tone: MusicNotificationTone } | undefined => {
  if (Object.prototype.hasOwnProperty.call(KINDS, kind)) return KINDS[kind];
  const sync = SYNC_KIND.exec(kind);
  if (!sync) return undefined;
  return sync[1] === "done" ? { key: "syncDone", tone: "done" } : { key: "syncFailed", tone: "failed" };
};

/** Kinds that change what the library holds. */
export const changesLibrary = (n: MusicNotification): boolean =>
  n.tone === "done" && !n.kind.startsWith("vocal_");

export const parseMusicNotification = (raw: unknown): MusicNotification | null => {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const kind = String(record.kind ?? "");
  const known = describeKind(kind);
  if (!known) return null;
  const context =
    record.context && typeof record.context === "object" ? (record.context as Record<string, unknown>) : {};
  const title = [context.title, context.artist_name].find((v): v is string => typeof v === "string" && v.length > 0);
  const songId = Number(context.song_id);
  return {
    id: Number(record.id),
    kind,
    tone: known.tone,
    // A failed link has no title yet, only its address: never show that.
    key: title && !/^https?:/i.test(title) ? known.key : `${known.key}Untitled`,
    params: title ? { title } : {},
    songId: Number.isInteger(songId) && songId > 0 ? songId : null,
    createdAt: String(record.created_at ?? ""),
    read: record.read === true,
  };
};
