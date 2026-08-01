/**
 * Per-launch device id for PlaybackChannel presence (FR-106): 8-64 chars of
 * [A-Za-z0-9-], minted once per app launch (NOT persisted; a relaunch is a
 * new device to the registry, matching the web's behavior).
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export const randomDeviceId = (length = 32): string => {
  const size = Math.max(8, Math.min(64, length));
  const globalCrypto = (globalThis as { crypto?: Crypto }).crypto;
  if (globalCrypto?.getRandomValues) {
    const bytes = new Uint8Array(size);
    globalCrypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
  }
  let out = "";
  for (let i = 0; i < size; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
};

let launchDeviceId: string | null = null;

/** Stable for the lifetime of this JS context. */
export const getLaunchDeviceId = (): string => {
  if (!launchDeviceId) launchDeviceId = randomDeviceId();
  return launchDeviceId;
};
