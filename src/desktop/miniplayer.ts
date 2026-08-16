/**
 * O contrato entre as DUAS janelas do shell desktop (plano 3.5). A janela do
 * mini-player carrega o mesmo bundle com `?miniplayer=1` e nao tem player
 * nenhum: e uma superficie remota da janela principal, exactamente como o
 * ecra de bloqueio ou um controlador.
 *
 * Porque eventos do Tauri e nao a PlaybackChannel do backend: o mini-player
 * NAO e outro dispositivo. Entrar no canal de presenca criaria um segundo
 * device do mesmo utilizador, com disputa de "quem esta activo" e ida ao
 * servidor para mexer numa janela que esta a 20px de distancia. O emit do
 * Tauri e local ao processo, chega as duas janelas e nao existe fora do
 * shell.
 *
 * Direccao da verdade, o mesmo do lockScreen.ts: estado sai da janela
 * principal, comandos entram por RemoteCommand e sao despachados pelo
 * routeRemoteCommand - nunca pelo motor directamente.
 */
import { getTauriGlobals } from "./tauri";

/** Estado que a janela principal publica; o mini-player so o desenha. */
export interface MiniplayerState {
  title: string;
  artist: string;
  artworkUrl: string | null;
  playing: boolean;
  /** Segundos; a posicao autoritativa vive sempre no motor. */
  position: number;
  duration: number;
  /** Sem musica: o mini-player mostra o estado vazio em vez de zeros. */
  hasSong: boolean;
}

export const MINIPLAYER_STATE_EVENT = "miniplayer-state";
export const MINIPLAYER_COMMAND_EVENT = "miniplayer-command";

export const EMPTY_MINIPLAYER_STATE: MiniplayerState = {
  title: "",
  artist: "",
  artworkUrl: null,
  playing: false,
  position: 0,
  duration: 0,
  hasSong: false,
};

/**
 * Estamos DENTRO da janela do mini-player? Tres fontes, todas sincronas
 * (o boot inteiro depende de a resposta existir antes do primeiro modulo):
 *
 * 1. `__OMS_MINIPLAYER__`, injectado pelo Rust por initialization_script
 *    (miniplayer.rs) - o mesmo mecanismo do `__OMS_DESKTOP__`, imune ao URL.
 * 2. O label da janela nos internals do Tauri v2. Serve de rede para um
 *    shell construido antes do script de injeccao existir.
 * 3. O query param historico, que so sobrevive no dev server: no shell
 *    construido o protocolo `tauri://` percent-encoda o `?` de
 *    `WebviewUrl::App("index.html?miniplayer=1")` e a janela aterrava com
 *    path `/index.html%3Fminiplayer=1` e search vazio - dai o
 *    "Unmatched Route" preso que o dono viu (2026-08-17). O URL deixou de
 *    ser o canal principal por isso mesmo.
 */
export const isMiniplayerWindow = (): boolean => {
  if ((globalThis as { __OMS_MINIPLAYER__?: unknown }).__OMS_MINIPLAYER__ === true) {
    return true;
  }
  const internals = (
    globalThis as {
      __TAURI_INTERNALS__?: { metadata?: { currentWebview?: { label?: unknown } } };
    }
  ).__TAURI_INTERNALS__;
  if (internals?.metadata?.currentWebview?.label === "miniplayer") return true;
  if (typeof location === "undefined") return false;
  return new URLSearchParams(location.search).get("miniplayer") === "1";
};

/** Narrowing defensivo: o payload atravessa IPC e chega como unknown. */
export const toMiniplayerState = (payload: unknown): MiniplayerState | null => {
  if (!payload || typeof payload !== "object") return null;
  const raw = payload as Record<string, unknown>;
  if (typeof raw.hasSong !== "boolean") return null;
  const num = (value: unknown): number =>
    typeof value === "number" && Number.isFinite(value) ? value : 0;
  return {
    title: typeof raw.title === "string" ? raw.title : "",
    artist: typeof raw.artist === "string" ? raw.artist : "",
    artworkUrl: typeof raw.artworkUrl === "string" ? raw.artworkUrl : null,
    playing: raw.playing === true,
    position: num(raw.position),
    duration: num(raw.duration),
    hasSong: raw.hasSong,
  };
};

/** Fire-and-forget: um estado perdido corrige-se no proximo emit. */
export const emitMiniplayerState = (state: MiniplayerState): void => {
  void getTauriGlobals()?.event.emit?.(MINIPLAYER_STATE_EVENT, state);
};

export const emitMiniplayerCommand = (command: { kind: string; seconds?: number }): void => {
  void getTauriGlobals()?.event.emit?.(MINIPLAYER_COMMAND_EVENT, command);
};
