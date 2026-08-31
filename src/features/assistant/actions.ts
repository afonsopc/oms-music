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

const runAction = (action: AssistantAction, router: Router): void => {
  const transport = getTransport();
  switch (action.action) {
    case "play":
      // As musicas vem serializadas pelo servidor (SongBlueprint inteiro); o
      // Song do SDK e o fio, o do dominio marca os ids - por isso a conversao
      // passa por unknown: os ids do dominio sao marcados e os do fio nao.
      if (action.shuffle) {
        transport.setQueue(action.songs as unknown as Song[], undefined, { shuffle: true });
      } else transport.setQueue(action.songs as unknown as Song[], 0);
      break;
    case "queue":
      queueSongs(action.songs as unknown as Song[], action.mode);
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
      transport.setShuffle(action.on);
      break;
    case "set_loop":
      transport.setLoopMode(action.mode);
      break;
    case "set_volume":
      transport.setVolume(action.value);
      break;
    case "set_rate":
      transport.setRate(action.value);
      break;
    case "sleep_timer":
      // Local ao dispositivo que ouve, como no cog (settingsSheet).
      if ("off" in action) getPlayerEngine().setSleepTimer(null);
      else if ("end_of_song" in action) getPlayerEngine().setSleepTimer({ endOfSong: true });
      else if (action.minutes) getPlayerEngine().setSleepTimer({ minutes: action.minutes });
      break;
    case "open":
      router.push(openHref(action));
      break;
  }
};

/**
 * Executa as acções pela ordem do servidor. Uma acção que rebente não pode
 * afundar as seguintes nem o chat: engole-se com um warn.
 */
export const runAssistantActions = (
  actions: readonly AssistantAction[] | undefined,
  router: Router,
): void => {
  for (const action of actions ?? []) {
    try {
      runAction(action, router);
    } catch (error) {
      console.warn("[assistant] action failed", action.action, error);
    }
  }
};
