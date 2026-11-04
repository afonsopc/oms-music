/**
 * O braço do assistente dentro da app (2026-08-21). O servidor valida e
 * devolve `actions` já com as músicas serializadas; aqui só se EXECUTA:
 * transport para o leitor (o decorator remoto vem de graça - em modo
 * controlador os comandos seguem pelo cabo), engine para o sleep timer
 * (o mesmo caminho do cog) e router para navegação. Nada aqui volta a
 * validar ids: quem valida é o servidor, como sempre.
 */
import type { useRouter } from "expo-router";
import type { AssistantAction, AssistantPlayerContext } from "@/api/queries/assistantChats";
import type { Song } from "@/domain/song";
import { getTransport } from "@/contracts/transport";
import { artistNamesLine } from "@/domain/format";
import { albumRoute, artistRoute, playlistRoute } from "@/lib/routes";
import { getPlayerEngine } from "@/player/register";
import { playerStore } from "@/player/store";
import { setLocale, type Locale } from "@/i18n";
import { isTranslationTarget } from "@/lyrics/translation";
import { storeTranslationOn, storeTranslationTarget } from "@/features/lyrics/targetStore";
import type { ThemeMode } from "@/theme/provider";
import { runImportAction, type ImportAction } from "./imports";

/**
 * As acções novas (2026-11-04), ainda fora do SDK: saltar para um tempo,
 * abrir a letra (traduzida), mudar uma definição e, só na web e no
 * computador, importar.
 */
type ExtraAction =
  | { action: "seek"; seconds: number }
  | { action: "show_lyrics"; translate?: string }
  | { action: "set_setting"; key: "theme" | "language" | "lyrics_translation"; value: string }
  | { action: "open"; target: "lyrics" | "queue" }
  | ImportAction;

export type AnyAssistantAction = AssistantAction | ExtraAction;

/** O que só um componente React tem à mão (o tema vem do contexto). */
export interface AssistantActionContext {
  setThemeMode?: (mode: ThemeMode) => void;
  /** Uma importação pedida que falhou: o chat diz porquê. */
  onImportError?: (action: ImportAction, error: unknown) => void;
}

/** O que useRouter devolve (expo-router não exporta o tipo directamente). */
type Router = ReturnType<typeof useRouter>;

/** Snapshot do leitor que acompanha cada mensagem ao assistente. */
export const collectPlayerContext = (): AssistantPlayerContext => {
  const s = playerStore.getState();
  return {
    song_id: s.currentSong?.id ?? null,
    title: s.currentSong?.title ?? null,
    artist: s.currentSong ? artistNamesLine(s.currentSong.artist_names) : null,
    playing: s.playing,
    volume: s.volume,
    shuffle: s.shuffle,
    loop_mode: s.loopMode,
    rate: s.rate,
    queue_length: s.queue.length,
  };
};

const queueSongs = (songs: Song[], mode: "next" | "last"): void => {
  const transport = getTransport();
  if (mode === "next") {
    // playNext insere logo a seguir à actual: por ordem inversa, o bloco
    // fica na fila pela ordem proposta.
    for (const song of [...songs].reverse()) transport.playNext(song);
  } else {
    for (const song of songs) transport.addToQueue(song);
  }
};

const openHref = (action: Extract<AssistantAction, { action: "open" }>) => {
  switch (action.target) {
    case "playlist":
      return playlistRoute(action.playlist_id);
    case "artist":
      return artistRoute(action.artist);
    case "album":
      return albumRoute(action.artist, action.album);
    case "liked":
      return "/liked" as const;
    case "settings":
      return "/settings" as const;
  }
};

const runExtraAction = (action: ExtraAction, router: Router, ctx: AssistantActionContext): boolean => {
  switch (action.action) {
    case "seek":
      getTransport().seek(action.seconds);
      return true;
    case "show_lyrics":
      if (action.translate && isTranslationTarget(action.translate)) {
        storeTranslationTarget(action.translate);
        storeTranslationOn(true);
      }
      router.push("/(player)/lyrics");
      return true;
    case "set_setting":
      if (action.key === "theme" && ["light", "dark", "system"].includes(action.value)) {
        ctx.setThemeMode?.(action.value as ThemeMode);
      } else if (action.key === "language" && ["pt", "en", "lv"].includes(action.value)) {
        setLocale(action.value as Locale);
      } else if (action.key === "lyrics_translation") {
        if (action.value === "off") storeTranslationOn(false);
        else if (isTranslationTarget(action.value)) {
          storeTranslationTarget(action.value);
          storeTranslationOn(true);
        }
      }
      return true;
    case "open":
      if (action.target === "lyrics" || action.target === "queue") {
        router.push(action.target === "lyrics" ? "/(player)/lyrics" : "/(player)/queue");
        return true;
      }
      return false;
    case "import_link":
    case "follow_artist":
    case "sync_playlist_link":
      runImportAction(action).catch((error: unknown) => ctx.onImportError?.(action, error));
      return true;
  }
  return false;
};

const runAction = (action: AnyAssistantAction, router: Router, ctx: AssistantActionContext): void => {
  if (runExtraAction(action as ExtraAction, router, ctx)) return;
  const known = action as AssistantAction;
  const transport = getTransport();
  switch (known.action) {
    case "play":
      // As musicas vem serializadas pelo servidor (SongBlueprint inteiro); o
      // Song do SDK e o fio, o do dominio marca os ids - por isso a conversao
      // passa por unknown: os ids do dominio sao marcados e os do fio nao.
      if (known.shuffle) {
        transport.setQueue(known.songs as unknown as Song[], undefined, { shuffle: true });
      } else transport.setQueue(known.songs as unknown as Song[], 0);
      break;
    case "queue":
      queueSongs(known.songs as unknown as Song[], known.mode);
      break;
    case "pause":
      transport.pause();
      break;
    case "resume":
      transport.play();
      break;
    case "skip":
      transport.next();
      break;
    case "previous":
      transport.previous();
      break;
    case "set_shuffle":
      transport.setShuffle(known.on);
      break;
    case "set_loop":
      transport.setLoopMode(known.mode);
      break;
    case "set_volume":
      transport.setVolume(known.value);
      break;
    case "set_rate":
      transport.setRate(known.value);
      break;
    case "sleep_timer":
      // Local ao dispositivo que ouve, como no cog (settingsSheet).
      if ("off" in known) getPlayerEngine().setSleepTimer(null);
      else if ("end_of_song" in known) getPlayerEngine().setSleepTimer({ endOfSong: true });
      else if (known.minutes) getPlayerEngine().setSleepTimer({ minutes: known.minutes });
      break;
    case "open":
      router.push(openHref(known));
      break;
  }
};

/**
 * Executa as acções pela ordem do servidor. Uma acção que rebente não pode
 * afundar as seguintes nem o chat: engole-se com um warn.
 */
export const runAssistantActions = (
  actions: readonly AnyAssistantAction[] | undefined,
  router: Router,
  ctx: AssistantActionContext = {},
): void => {
  for (const action of actions ?? []) {
    try {
      runAction(action, router, ctx);
    } catch (error) {
      console.warn("[assistant] action failed", action.action, error);
    }
  }
};
