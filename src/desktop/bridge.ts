/**
 * Desktop bridge (plano "uma so app" F5): feeds the shell's native surfaces -
 * media keys, macOS Now Playing, MPRIS, tray - from the existing player
 * store, and routes their commands back through the transport seam. Off the
 * desktop shell (native apps, plain web) `startDesktopBridge()` finds no
 * Tauri global and does exactly nothing.
 *
 * Direction of truth, same discipline as lockScreen.ts:
 *  - state flows OUT: playerStore -> `update_now_playing` / `update_playback`
 *    commands. Rust is a dumb mirror; the authoritative position stays in the
 *    engine.
 *  - commands flow IN: the shell emits "media-command" events whose payload
 *    is EXACTLY the RemoteCommand shape, so they dispatch through
 *    routeRemoteCommand - never the engine directly, which keeps a controller
 *    driving the ACTIVE device once the remote decorator is installed.
 *
 * The pure pieces (payload parsing, send discipline) live in ./protocol so
 * they test without dragging react-native into bun test.
 */
import { router } from "expo-router";
import { openCinema } from "@/features/player/cinema";
import { buildLockScreenMetadata, routeRemoteCommand } from "@/player/lockScreen";
import { playerStore, type PlayerStoreState } from "@/player/store";
import { toSongKey } from "@/domain/ids";
import { playbackUpdateReason, toRemoteCommand, type SentPlayback } from "./protocol";
import { getTauriGlobals } from "./tauri";

/** Event names from desktop/bindings.ts (tauri-specta derives them). */
const MEDIA_COMMAND_EVENT = "media-command";
const SHELL_COMMAND_EVENT = "shell-command";

let running = false;

/**
 * Idempotent; called by boot wiring. Returns true when the bridge attached
 * (i.e. we are inside the desktop shell), false when it no-oped.
 */
export const startDesktopBridge = (): boolean => {
  if (running) return true;
  const tauri = getTauriGlobals();
  if (!tauri) return false;
  running = true;

  // Commands IN: media keys / Now Playing / tray -> transport seam.
  void tauri.event.listen(MEDIA_COMMAND_EVENT, (event) => {
    const command = toRemoteCommand(event.payload);
    if (command) routeRemoteCommand(command);
  });

  // Shell UI commands (menu bar Vista/OMS Music): cinema opens the desktop
  // overlay store directly; settings navigates. Payload shape is the specta
  // ShellCommand ({ type: "cinema" | "settings" }); unknown types no-op so
  // an older bundle under a newer shell never throws.
  void tauri.event.listen(SHELL_COMMAND_EVENT, (event) => {
    const payload = event.payload as { type?: string } | null;
    if (payload?.type === "cinema") {
      openCinema();
    } else if (payload?.type === "settings") {
      router.push("/(main)/settings");
    }
  });

  // State OUT: playerStore -> shell. Fire-and-forget by design: a lost
  // mirror update self-heals on the next one, and the player must never
  // block on IPC.
  let last: SentPlayback | null = null;
  let lastMetadataKey: string | null = null;
  /** True while the sent metadata carried durationS null (song flipped
   *  before the adapter reported a duration - the common case). */
  let sentDurationNull = false;

  const push = (state: PlayerStoreState): void => {
    const song = state.currentSong;
    const songKey: string | null = song ? toSongKey(song.id) : null;
    const nowMs = Date.now();

    // Re-send once when the REAL duration lands: the first metadata push
    // almost always races the adapter's metadata load and ships null, and
    // nothing else would ever correct the shell's track-length mirror.
    const durationArrived = sentDurationNull && songKey === lastMetadataKey && state.duration > 0;

    if (songKey !== lastMetadataKey || durationArrived) {
      lastMetadataKey = songKey;
      if (song) {
        // Same resolution the lock screen uses: local artwork first, then
        // the media URL - one metadata builder, not two.
        const metadata = buildLockScreenMetadata(song);
        sentDurationNull = !(state.duration > 0);
        void tauri.core.invoke("update_now_playing", {
          nowPlaying: {
            title: metadata.title,
            artist: metadata.artist,
            albumTitle: metadata.albumTitle,
            artworkUrl: metadata.artworkUrl ?? null,
            durationS: state.duration > 0 ? state.duration : null,
          },
        });
      } else {
        sentDurationNull = false;
        void tauri.core.invoke("update_now_playing", { nowPlaying: null });
      }
    }

    const reason = playbackUpdateReason(last, songKey, state, nowMs);
    if (!reason) return;
    last = {
      songKey,
      playing: state.playing,
      position: state.position,
      rate: state.rate,
      wallMs: nowMs,
    };
    if (songKey) {
      void tauri.core.invoke("update_playback", {
        playing: state.playing,
        positionS: state.position,
      });
    }
  };

  playerStore.subscribe(push);
  push(playerStore.getState());
  return true;
};
