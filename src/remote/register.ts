/**
 * Remote playback composition root (imported by boot/wireup.ts, WP12).
 *
 * This is the ONLY file in src/remote that knows about the concrete engine,
 * the cable singleton, the session store and react-native - the protocol
 * modules (channel, publisher, controller, transport, commands, adoption)
 * see nothing but the interfaces in localPlayer.ts, so they stay testable
 * with fakes in bun.
 *
 * Wiring, in order:
 *  1. the remote-aware transport decorator on top of the engine base
 *     (contracts/transport) - this is what makes a lock-screen "next" on a
 *     controller advance the ACTIVE device (FR-63 remote half);
 *  2. the PlaybackChannel manager over the hand-rolled cable client;
 *  3. auth gating: connect while authed with a live credential (Bearer
 *     token, or the session cookie on a cookie origin), disconnect and
 *     wipe on logout or auth loss (the guard flips authReady false FIRST);
 *  4. the app-wide foreground pump: AppState "active" heals the socket and
 *     fires every subscription wake hook (request_snapshot + heartbeat).
 *
 * The shell surfaces (cast button, controller strip, DevicePicker sheet)
 * register separately from features/devices/register.ts, because src/remote
 * must not import from src/features.
 */
import { AppState, type AppStateStatus } from "react-native";
import * as Device from "expo-device";
import { getCableClient } from "@/cable/client";
import { setTransportDecorator } from "@/contracts/transport";
import { isAuthReady, subscribeAuthReady } from "@/auth/guard";
import { registerLogoutTask, useSessionStore } from "@/auth/session";
import { cableCredential } from "@/auth/token";
import { getLaunchDeviceId } from "@/lib/uuid";
import { setLockScreenSongOverride } from "@/player/lockScreen";
import { getPlayerEngine } from "@/player/register";
import { playerStore } from "@/player/store";
import {
  PlaybackChannelManager,
  getPlaybackChannel,
  setPlaybackChannel,
  type RemoteNotice,
} from "./channel";
import { setRemoteSongLookup } from "./commands";
import { querySongLookup } from "./songResolver";
import { createRemoteTransportDecorator } from "./transport";

// ---------------------------------------------------------------------------
// Notices (no toast host exists yet; same registered-handler pattern as
// player/recovery.ts, so this module never imports the i18n runtime).
// ---------------------------------------------------------------------------

export interface RemoteNoticeMessage {
  key: string;
  params?: Record<string, string>;
}

export type RemoteNoticeHandler = (message: RemoteNoticeMessage) => void;

let noticeHandler: RemoteNoticeHandler = (message) => {
  console.warn(`[remote] ${message.key}`);
};

/** The shell registers the real toast (translating the key through t()). */
export const setRemoteNoticeHandler = (handler: RemoteNoticeHandler): void => {
  noticeHandler = handler;
};

const emitNotice = (notice: RemoteNotice): void => {
  if (notice.kind === "no_active_device") {
    noticeHandler({ key: "components.music.RemotePlayback.noActiveDevice" });
    return;
  }
  noticeHandler({
    key: "components.music.RemotePlayback.deviceNeedsTap",
    params: { device: notice.deviceLabel },
  });
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/** Free-form hint the server slices to 80 chars when naming the row. */
const deviceLabelHint = (): string => {
  const name = Device.deviceName?.trim();
  const model = Device.modelName?.trim();
  const os = Device.osName?.trim();
  if (name && os) return `${name} - ${os}`;
  return name || model || os || "oms-music";
};

let registered = false;
let appStateSub: { remove(): void } | null = null;

const shouldConnect = (): boolean => {
  const session = useSessionStore.getState();
  // null = no credential; "" = cookie auth (still a live credential).
  return session.status === "authed" && isAuthReady() && cableCredential() !== null;
};

const syncConnection = (): void => {
  const channel = getPlaybackChannel();
  if (!channel) return;
  const cable = getCableClient();
  const credential = cableCredential();
  if (shouldConnect() && credential !== null) {
    cable.connect(credential);
    channel.start();
    return;
  }
  if (channel.isStarted()) channel.stop();
  cable.disconnect();
};

/**
 * Idempotent; boot/wireup.ts calls it once. Safe to call before login: the
 * channel only starts once the session store reports an authed session.
 */
export const registerRemotePlayback = (): void => {
  if (registered) return;
  registered = true;

  const engine = getPlayerEngine();
  // Id-only commands resolve through the query cache, then REST.
  setRemoteSongLookup(querySongLookup);

  const channel = new PlaybackChannelManager({
    cable: getCableClient(),
    engine,
    localState: playerStore,
    deviceId: getLaunchDeviceId(),
    deviceLabel: deviceLabelHint(),
    setLockScreenSong: setLockScreenSongOverride,
    notify: emitNotice,
    deviceFallbackLabel: "device",
  });
  setPlaybackChannel(channel);

  setTransportDecorator(
    createRemoteTransportDecorator({
      engine,
      localState: playerStore,
      sendCommand: (command, args) => getPlaybackChannel()?.sendCommand(command, args),
      claimActive: (mode) => getPlaybackChannel()?.claimActive(mode),
      markTakeover: () => getPlaybackChannel()?.markTakeover(),
      markSelfClaim: () => getPlaybackChannel()?.markSelfClaim(),
    }),
  );

  // Auth gating. Both the session status and the authReady gate can move
  // independently (a 401 probe flips authReady first, THEN wipes).
  useSessionStore.subscribe(syncConnection);
  subscribeAuthReady(syncConnection);
  registerLogoutTask(() => {
    getPlaybackChannel()?.stop();
    getCableClient().disconnect();
  });

  // Foreground pump: iOS freezes the socket and every timer in background.
  appStateSub = AppState.addEventListener("change", (status: AppStateStatus) => {
    if (status !== "active") return;
    getPlaybackChannel()?.notifyForeground();
  });

  syncConnection();
};

/** Test/teardown helper; production never unregisters. */
export const unregisterRemotePlayback = (): void => {
  if (!registered) return;
  registered = false;
  appStateSub?.remove();
  appStateSub = null;
  getPlaybackChannel()?.stop();
  setPlaybackChannel(null);
  setTransportDecorator(null);
};
