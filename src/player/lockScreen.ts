/**
 * Lock screen metadata + remote command routing (FR-54/63; DESIGN 8.6).
 *
 * Metadata: `setActiveForLockScreen(true, metadata)` on EVERY song change,
 * play-state change and metadata patch (Android background audio dies at
 * ~3 min without it). A FRESH metadata object per song. Artwork prefers the
 * local downloaded file, else the `/data?token=` image URL (rate-exempt).
 * Metadata follows the song the user is HEARING ABOUT: WP9 sets the
 * controller override via setLockScreenSongOverride while another device is
 * active (wired through boot, since remote/ cannot import player/).
 *
 * Remote commands: registered ONCE and dispatched through
 * contracts/transport, so a controller's lock-screen action advances the
 * ACTIVE device once WP9 registers its decorator. expo-audio still handles
 * play/pause/seek/skip(+-10 s) natively against the player and emits no JS
 * events for them (harmless: the engine mirrors status updates into the
 * store). next/previous are ours: the local `oms-native` module registers
 * additive targets on the process-wide MPRemoteCommandCenter and calls
 * routeRemoteCommand through the router installed here by register.ts.
 * Android has no next/previous at all - expo-audio strips those commands
 * from the only MediaSession the app has (docs/LOCKSCREEN-PATCH.md).
 */
import { getTransport } from "@/contracts/transport";
import { getLocalFileIndex } from "@/contracts/localSource";
import { imageUrl } from "@/api/mediaUrl";
import { toSongKey } from "@/domain/ids";
import { formatArtistsFull } from "@/domain/format";
import { songArtworkSource } from "@/domain/artwork";
import type { Song } from "@/domain/song";
import { playerStore } from "./store";
import type { AudioAdapter, LockScreenMetadata } from "./types";
// Pure submodule on purpose: the native accessor (and its react-native drag)
// is register.ts's business, not this file's.
import {
  inertRemoteTrackRouter,
  type RemoteTrackRouter,
} from "../../modules/oms-native/src/remoteTrackCommands";

export type RemoteCommand =
  | { kind: "play" }
  | { kind: "pause" }
  | { kind: "toggle" }
  | { kind: "next" }
  | { kind: "previous" }
  | { kind: "seek"; seconds: number }
  | { kind: "seekForward" } // +10 s
  | { kind: "seekBackward" }; // -10 s

const SEEK_JUMP_S = 10;

let overrideSong: Song | null = null;
let lastPublished: { adapter: AudioAdapter; song: Song | null } | null = null;
let trackRouter: RemoteTrackRouter = inertRemoteTrackRouter;

/**
 * register.ts installs the `oms-native` router here (inert when the native
 * module is absent, i.e. Expo Go, web and every Android build). Kept behind a
 * setter so this file never imports native code.
 */
export const setRemoteTrackRouter = (router: RemoteTrackRouter): void => {
  if (trackRouter !== inertRemoteTrackRouter) trackRouter.stop();
  trackRouter = router;
  if (lastPublished) router.setActive((overrideSong ?? lastPublished.song) !== null);
};

/** Fresh metadata object per song (never mutate a previous one). */
export const buildLockScreenMetadata = (song: Song): LockScreenMetadata => {
  const metadata: LockScreenMetadata = {
    title: song.title,
    artist: formatArtistsFull(song) || "",
    albumTitle: song.album ?? "",
  };
  const local = getLocalFileIndex().get(toSongKey(song.id), "artwork");
  if (local) {
    metadata.artworkUrl = local;
    return metadata;
  }
  const source = songArtworkSource(song);
  if (source.kind === "external") metadata.artworkUrl = source.url;
  else if (source.kind === "node") metadata.artworkUrl = imageUrl(source.nodeId);
  return metadata;
};

/**
 * Publish the lock screen state for the song the user hears about. Called
 * by the register wiring on songChanged / playStateChanged / patch events.
 */
export const publishLockScreen = (adapter: AudioAdapter, localSong: Song | null): void => {
  const song = overrideSong ?? localSong;
  lastPublished = { adapter, song: localSong };
  // The next/previous buttons exist exactly while a song is on the lock
  // screen: expo-audio's own disableRemoteCommands never touches them, so
  // nobody else would ever turn them off.
  trackRouter.setActive(song !== null);
  if (!song) {
    adapter.setLockScreenActive(false);
    return;
  }
  adapter.setLockScreenActive(true, buildLockScreenMetadata(song));
};

/**
 * WP9 (via boot wiring): while this device is a controller the metadata
 * follows the remote snapshot song; null returns to the local song.
 */
export const setLockScreenSongOverride = (song: Song | null): void => {
  overrideSong = song;
  if (lastPublished) publishLockScreen(lastPublished.adapter, lastPublished.song);
};

/**
 * Remote command dispatch through the transport seam - NEVER the engine
 * directly, so a controller's lock screen drives the active device.
 */
export const routeRemoteCommand = (command: RemoteCommand): void => {
  const transport = getTransport();
  switch (command.kind) {
    case "play":
      transport.play();
      break;
    case "pause":
      transport.pause();
      break;
    case "toggle":
      transport.toggle();
      break;
    case "next":
      transport.next();
      break;
    case "previous":
      transport.previous();
      break;
    case "seek":
      transport.seek(Math.max(0, command.seconds));
      break;
    case "seekForward":
      transport.seek(currentPositionFromStore() + SEEK_JUMP_S);
      break;
    case "seekBackward":
      transport.seek(Math.max(0, currentPositionFromStore() - SEEK_JUMP_S));
      break;
  }
};

const currentPositionFromStore = (): number => playerStore.getState().position;
