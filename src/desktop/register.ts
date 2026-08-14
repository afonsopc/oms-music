/**
 * Composition-root entry for the desktop bridge (boot/wireup.ts step 9).
 * Kept as a registrar for symmetry with every other subsystem: wireup calls
 * it unconditionally, the bridge itself decides - by probing the Tauri
 * global - whether there is a shell to talk to.
 */
import { startDesktopBridge } from "./bridge";

let registered = false;

/** Idempotent, like every registrar (Fast Refresh re-imports are harmless). */
export const registerDesktopBridge = (): void => {
  if (registered) return;
  registered = true;
  startDesktopBridge();
};
