/**
 * The online/offline flag on desktop.
 *
 * `downloads/offlineLibrary.ts` owns the flag itself, and it is reused here
 * verbatim rather than reimplemented: its state is pure JS plus kv, with no
 * expo-file-system or expo-sqlite anywhere near it, and the GO OFFLINE
 * override composes with the network flag in exactly one place for both
 * platforms. A second flag would be a second truth about "am I offline", and
 * the offline resolvers read only one of them.
 *
 * The only platform-specific part is the SOURCE of the network signal:
 * NetInfo on native, `window.online` / `window.offline` here. Those two events
 * report the browser's own connectivity guess, which inside a Tauri webview is
 * the OS's guess - good enough for "skip a doomed request", which is all the
 * flag is used for, and the offline resolver still catches a network failure
 * that slips through.
 */
import { hydrateManualOffline, setOnlineState } from "../offlineLibrary";

let attached = false;

export const registerDesktopOnlineState = (): void => {
  if (attached) return;
  attached = true;

  // BEFORE any network event: a persisted GO OFFLINE must never let the boot
  // flash online first (and kick off a library sweep the user forbade).
  hydrateManualOffline();

  if (typeof window === "undefined" || typeof window.addEventListener !== "function") {
    return;
  }
  // navigator.onLine is famously optimistic (it answers "there is an
  // interface", not "there is internet"), so it is used only as the initial
  // seed; the events below are what actually move the flag, and a request
  // that fails anyway still falls through to the offline resolver.
  const initial =
    typeof navigator === "undefined" || typeof navigator.onLine !== "boolean"
      ? true
      : navigator.onLine;
  setOnlineState(initial);
  window.addEventListener("online", () => setOnlineState(true));
  window.addEventListener("offline", () => setOnlineState(false));
};
