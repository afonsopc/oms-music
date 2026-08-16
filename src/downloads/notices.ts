/**
 * Download notices: the one channel for user-visible refusals (FR-88 WiFi
 * gate) and enqueue failures. Mirrors the player's toast-handler seam so the
 * downloads subsystem never imports a UI surface: it emits i18n KEYS, and a
 * surface registers the handler that translates and shows them: boot wires the
 * global notice host (boot/notices) at startup, and the Downloads screen takes
 * over while it is FOCUSED so its refusals render inline instead of as a
 * floating toast (it restores the global handler on blur - tab screens stay
 * mounted once visited, so a mount-scoped takeover would silently swallow
 * every later refusal raised from another screen).
 *
 * Default handler: a console warning, so headless callers (repair passes,
 * collection sync) stay silent but debuggable.
 */

export type DownloadNoticeHandler = (messageKey: string) => void;

const defaultHandler: DownloadNoticeHandler = (key) => {
  console.warn(`[downloads] ${key}`);
};

let handler: DownloadNoticeHandler = defaultHandler;

export const setDownloadNoticeHandler = (next: DownloadNoticeHandler | null): void => {
  handler = next ?? defaultHandler;
};

/** For surfaces that take over temporarily and must restore what they found. */
export const getDownloadNoticeHandler = (): DownloadNoticeHandler => handler;

export const notifyDownloadNotice = (messageKey: string): void => {
  handler(messageKey);
};

/** i18n keys emitted by this subsystem (all three catalogs). */
export const NOTICE_KEYS = {
  wifiRefused: "native.downloads.noWifiRefused",
  enqueueFailed: "native.downloads.enqueueFailed",
  /** FR-94: o total local excede a quota de música da conta. */
  storageCapRefused: "native.downloads.storageCapRefused",
} as const;
