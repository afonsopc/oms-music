/**
 * Native accessor for the local `oms-native` Expo module.
 *
 * The module is OPTIONAL on purpose: Expo Go, the web bundle and any build made
 * before this module landed simply do not have it, and every call below then
 * degrades to a no-op instead of throwing. Android has the module but both of
 * its functions are documented no-ops (see android/.../OmsNativeModule.kt).
 */
import { requireOptionalNativeModule } from "expo";
import type {
  RemoteTrackCommands,
  RemoteTrackEvent,
  RemoteTrackSubscription,
} from "./remoteTrackCommands";

interface OmsNativeNativeModule {
  addListener(event: RemoteTrackEvent, listener: () => void): RemoteTrackSubscription;
  setRemoteTrackCommandsEnabled(enabled: boolean): void;
  excludeFromBackup(path: string): boolean;
}

const nativeModule = requireOptionalNativeModule<OmsNativeNativeModule>("OmsNative");

export const isOmsNativeAvailable = (): boolean => nativeModule !== null;

/** The FR-63 seam, or null when the native module is not in this binary. */
export const getRemoteTrackCommands = (): RemoteTrackCommands | null => {
  const native = nativeModule;
  if (!native) return null;
  return {
    addListener: (event, listener) => native.addListener(event, listener),
    setEnabled: (enabled) => {
      try {
        native.setRemoteTrackCommandsEnabled(enabled);
      } catch {
        // Lock-screen buttons are cosmetic; never let them break playback.
      }
    },
  };
};

/**
 * FR-84: marks a directory (or file) as excluded from cloud backup. iOS writes
 * `isExcludedFromBackup`; Android returns false because exclusion there is
 * declarative (this module's config plugin writes the backup rules XML).
 * Accepts a `file://` uri or a bare path. Never throws.
 */
export const excludeFromBackup = (path: string): boolean => {
  const native = nativeModule;
  if (!native) return false;
  try {
    return native.excludeFromBackup(path);
  } catch {
    // Missing path or a read-only volume; downloads still work unexcluded.
    return false;
  }
};
