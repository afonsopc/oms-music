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
import {
  emitMiniplayerState,
  isMiniplayerWindow,
  MINIPLAYER_COMMAND_EVENT,
  type MiniplayerState,
} from "./miniplayer";
import { playbackUpdateReason, toRemoteCommand, type SentPlayback } from "./protocol";
import { getTauriGlobals } from "./tauri";

/** Event names from desktop/bindings.ts (tauri-specta derives them). */
const MEDIA_COMMAND_EVENT = "media-command";
const SHELL_COMMAND_EVENT = "shell-command";

/** Ritmo do espelho para a janela do mini-player enquanto toca. A barra dele
 *  e um espelho, nao um relogio: 1 Hz chega e mantem o IPC irrelevante. */
const MINIPLAYER_TICK_MS = 1000;

let running = false;

/**
 * Idempotent; called by boot wiring. Returns true when the bridge attached
 * (i.e. we are inside the desktop shell), false when it no-oped.
 */
export const startDesktopBridge = (): boolean => {
  if (running) return true;
  const tauri = getTauriGlobals();
  if (!tauri) return false;
  // A janela do mini-player corre o MESMO bundle mas nao e o player: nao
  // alimenta Now Playing nem teclas de media (dois espelhos a escrever no
  // mesmo MPNowPlayingInfoCenter piscariam um contra o outro) e sobretudo
  // nao pode reemitir o estado que acabou de receber.
  if (isMiniplayerWindow()) return false;
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
      router.push("/settings");
    }
  });

  // State OUT: playerStore -> shell. Fire-and-forget by design: a lost
  // mirror update self-heals on the next one, and the player must never
  // block on IPC.
  let last: SentPlayback | null = null;
  let lastMetadataKey: string | null = null;
  /** Ultimo espelho enviado a janela do mini-player. */
  let lastMiniSent = 0;
  let lastMiniKey = "";
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

    // Espelho para a janela do mini-player: em TRANSICOES (musica, play/pausa,
    // duracao) e, enquanto toca, num tique de 1 Hz para a barra andar. O
    // metadata ja foi construido acima quando a musica mudou, por isso
    // reconstrui-lo aqui seria trabalho repetido - excepto no tique, onde nada
    // mudou e so a posicao viaja.
    const miniKey = `${songKey ?? ""}|${state.playing}|${Math.round(state.duration)}`;
    if (miniKey !== lastMiniKey || (state.playing && nowMs - lastMiniSent >= MINIPLAYER_TICK_MS)) {
      lastMiniKey = miniKey;
      lastMiniSent = nowMs;
      const meta = song ? buildLockScreenMetadata(song) : null;
      const mini: MiniplayerState = {
        title: meta?.title ?? "",
        artist: meta?.artist ?? "",
        artworkUrl: meta?.artworkUrl ?? null,
        playing: state.playing,
        position: state.position,
        duration: state.duration,
        hasSong: song !== null,
      };
      emitMiniplayerState(mini);
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

  // Comandos do mini-player: mesma porta que as teclas de media, mesmo
  // despacho - a outra janela nunca toca no motor, so pede. O "sync" e o
  // aperto de mao: a janela acaba de abrir e o player pode estar em pausa ha
  // uma hora, sem nada para publicar; sem isto ficaria vazia ate a musica
  // mudar. Fica DEPOIS do push por ser quem ele reinicia.
  void tauri.event.listen(MINIPLAYER_COMMAND_EVENT, (event) => {
    const kind = (event.payload as { kind?: unknown } | null)?.kind;
    if (kind === "sync") {
      lastMiniKey = "";
      push(playerStore.getState());
      return;
    }
    const command = toRemoteCommand(event.payload);
    if (command) routeRemoteCommand(command);
  });

  playerStore.subscribe(push);
  push(playerStore.getState());
  return true;
};
