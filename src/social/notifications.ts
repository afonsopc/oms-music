/**
 * NotificationsChannel handling (FR-118 delivery half).
 *
 * Jam invites have NO accept API: the invite is a notification, and the jam
 * then simply appears in `GET /jams` `joinable` (the friend-of-a-member rule
 * already authorizes the join). So all this layer does is surface the invite
 * and refresh the jams cache so the panel shows the new joinable row.
 *
 * The channel is generic (`{"channel":"NotificationsChannel"}`, per-user
 * stream). Frames: `{type:"created", notification, unread_count}` on arrival
 * and `{type:"unread_count", ...}` on read-state changes. Only `jam_invite`
 * matters to the music app; everything else is ignored on purpose.
 */
import type { CableClient, CableSubscription } from "@/cable/types";
import type { JamId, UserId } from "@/domain/ids";

export interface JamInvite {
  jamId: JamId;
  hostId: UserId | null;
  hostHandle: string | null;
  inviterId: UserId | null;
  inviterHandle: string | null;
}

export type JamInviteHandler = (invite: JamInvite) => void;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : null;

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

/** Parses a `jam_invite` notification; null for every other kind. */
export const parseJamInvite = (notification: unknown): JamInvite | null => {
  const record = asRecord(notification);
  if (!record || record.kind !== "jam_invite") return null;
  const context = asRecord(record.context);
  if (!context) return null;
  const jamId = Number(context.jam_id);
  if (!Number.isInteger(jamId)) return null;
  return {
    jamId: jamId as JamId,
    hostId: asString(context.host_id),
    hostHandle: asString(context.host_handle),
    inviterId: asString(context.inviter_id),
    inviterHandle: asString(context.inviter_handle),
  };
};

export interface NotificationsManagerDeps {
  cable: CableClient;
  onJamInvite: JamInviteHandler;
}

export class NotificationsManager {
  private sub: CableSubscription | null = null;
  private started = false;

  constructor(private readonly deps: NotificationsManagerDeps) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    this.sub = this.deps.cable.subscribe(
      { channel: "NotificationsChannel" },
      { onMessage: (msg) => this.handleMessage(msg) },
    );
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.sub?.unsubscribe();
    this.sub = null;
  }

  isStarted(): boolean {
    return this.started;
  }

  private handleMessage(raw: unknown): void {
    const msg = asRecord(raw);
    if (!msg || msg.type !== "created") return;
    const invite = parseJamInvite(msg.notification);
    if (!invite) return;
    this.deps.onJamInvite(invite);
  }
}
