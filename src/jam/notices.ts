/**
 * Jam notices: the one channel for user-visible jam messages (proposal
 * toasts, jam ended, auto-leave, failures). Mirrors downloads/notices.ts and
 * remote/register.ts so the jam subsystem never imports a UI surface: it
 * emits i18n KEYS plus params, and a surface registers the handler that
 * translates and shows them.
 *
 * Default handler: a console warning, so headless callers (the resume pass
 * on boot, the auto-leave watcher) stay silent but debuggable.
 */

export interface JamNotice {
  key: string;
  params?: Record<string, string | number>;
}

export type JamNoticeHandler = (notice: JamNotice) => void;

const defaultHandler: JamNoticeHandler = (notice) => {
  console.warn(`[jam] ${notice.key}`);
};

let handler: JamNoticeHandler = defaultHandler;

export const setJamNoticeHandler = (next: JamNoticeHandler | null): void => {
  handler = next ?? defaultHandler;
};

export const notifyJam = (notice: JamNotice): void => {
  handler(notice);
};

/** i18n keys emitted by this subsystem (present in all three catalogs). */
export const JAM_NOTICES = {
  started: "components.music.JamProvider.jamStarted",
  joined: "components.music.JamProvider.joinedJam",
  ended: "components.music.JamProvider.jamEnded",
  inviteSent: "components.music.JamProvider.inviteSent",
  leftForLocalPlayback: "components.music.JamProvider.leftJamLocalPlayback",
  songProposed: "components.music.JamProvider.songProposed",
  songSkipped: "components.music.JamProvider.songSkipped",
  proposalSent: "components.music.JamProvider.proposalSent",
  proposalFailed: "components.music.JamProvider.proposalFailed",
  skipVoteFailed: "components.music.JamProvider.skipVoteFailed",
  startFailed: "native.jam.startFailed",
  joinFailed: "native.jam.joinFailed",
  inviteFailed: "native.jam.inviteFailed",
  rulesFailed: "native.jam.rulesFailed",
  inviteReceived: "native.jam.inviteReceived",
} as const;
