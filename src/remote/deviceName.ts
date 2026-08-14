/**
 * Human device label for the playback registry (the `device_label` sent on
 * PlaybackChannel subscribe, sliced to 80 chars server-side and shown in the
 * device picker on every device).
 *
 * Before this module the hint was "<deviceName> - <os>", which produced rows
 * like "iPhone - iOS" on native and outright junk on web (expo-device's web
 * shim has no deviceName), so the picker filled up with indistinguishable
 * "Apple iOS 18.7"-style entries. The owner's ask (2026-08-14):
 *   - native: the actual MODEL ("iPhone 15", "Pixel 7");
 *   - web: browser + OS the way a person says it ("Chrome em Linux",
 *     "Safari num Mac").
 *
 * The label is stored server-side and shown to every device of the account,
 * so it cannot be per-viewer translated; the connectors are PT-PT by the
 * owner's explicit examples.
 *
 * Pure module (no react-native / expo imports): remote/register.ts feeds it
 * the real platform values, bun tests feed it fixtures.
 */

export interface DeviceLabelInputs {
  /** Platform.OS === "web" at the call site. */
  web: boolean;
  /** expo-device Device.modelName ("iPhone 15"; null on web). */
  modelName?: string | null;
  /** expo-device Device.deviceName (user-assigned; often generic on iOS 16+). */
  deviceName?: string | null;
  /** expo-device Device.osName ("iOS", "Android"; ua-parser OS name on web). */
  osName?: string | null;
  /** navigator.userAgent on web; ignored on native. */
  userAgent?: string | null;
}

const FALLBACK = "oms-music";

/** Browser family from the UA string, most-specific token first (Chrome
 *  ships "Safari/" in its UA, Edge ships "Chrome/", so order is the whole
 *  trick). */
export const browserFromUserAgent = (userAgent: string): string | null => {
  if (/Edg(e|A|iOS)?\//.test(userAgent)) return "Edge";
  if (/OPR\/|Opera\//.test(userAgent)) return "Opera";
  if (/SamsungBrowser\//.test(userAgent)) return "Samsung Internet";
  if (/Firefox\/|FxiOS\//.test(userAgent)) return "Firefox";
  if (/Chrome\/|CriOS\//.test(userAgent)) return "Chrome";
  if (/Safari\//.test(userAgent)) return "Safari";
  return null;
};

/**
 * "Where" the browser runs, as the PT-PT tail of the label ("em Linux",
 * "num Mac"). iPhone/iPad win over the generic OS name because "Safari num
 * iPhone" identifies the physical device the way "em iOS" never would.
 */
export const osPlacePt = (
  osName: string | null | undefined,
  userAgent: string,
): string | null => {
  if (/iPad/.test(userAgent)) return "num iPad";
  if (/iPhone/.test(userAgent)) return "num iPhone";
  const os = (osName ?? "").toLowerCase();
  if (!os) return null;
  if (os.includes("mac")) return "num Mac";
  if (os.includes("windows")) return "no Windows";
  if (os.includes("android")) return "em Android";
  if (os.includes("chrom")) return "num Chromebook";
  // Distro names count as Linux: ua-parser reports "Ubuntu"/"Fedora"/...
  // instead of plain "Linux" on many desktops.
  if (
    os.includes("linux") ||
    ["ubuntu", "fedora", "debian", "mint", "arch"].some((d) => os.includes(d))
  ) {
    return "em Linux";
  }
  return null;
};

export const deviceRegistrationLabel = (inputs: DeviceLabelInputs): string => {
  if (inputs.web) {
    const userAgent = inputs.userAgent ?? "";
    const browser = browserFromUserAgent(userAgent);
    const place = osPlacePt(inputs.osName, userAgent);
    if (browser && place) return `${browser} ${place}`;
    if (browser) return browser;
    return inputs.osName?.trim() || FALLBACK;
  }
  // Native: the model IS the human name ("iPhone 15"). deviceName backs it
  // up (a user-assigned name is fine too); the OS name is the last resort.
  return (
    inputs.modelName?.trim() ||
    inputs.deviceName?.trim() ||
    inputs.osName?.trim() ||
    FALLBACK
  );
};
