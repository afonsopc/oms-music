/** "O Melhor Assistente" (3.8): o modelo propõe, o servidor valida - e desde
 *  2026-08-16 GUARDA as conversas. O cliente continua deliberadamente burro:
 *  manda a mensagem nova (com `chat_id` quando a sessão já existe) e o
 *  histórico que alimenta o LLM é o DO SERVIDOR. Uma sessão cuja última
 *  mensagem tem mais de 2 dias fica `read_only` e o POST responde 423.
 *
 *  Desde 2026-08-21 o assistente também MANDA NO LEITOR: a resposta pode
 *  trazer `actions` (já validadas e com as músicas serializadas pelo
 *  servidor) que a app executa localmente, e o POST leva um snapshot do
 *  leitor para o modelo saber o que está a tocar. */
import { request } from "../client";
import type { LoopMode } from "@/domain/playback";
import type { Song } from "@/domain/song";

export interface AssistantMessage {
  role: "user" | "assistant";
  content: string;
  created_at?: string;
}

/**
 * Uma acção de leitor vinda do servidor. As músicas de play/queue chegam
 * SERIALIZADAS (o shape de GET /songs) e já passaram por viewable_by lá:
 * a app não re-consulta nada, só executa.
 */
export type AssistantAction =
  | { action: "play"; songs: Song[]; shuffle?: boolean }
  | { action: "queue"; songs: Song[]; mode: "next" | "last" }
  | { action: "pause" }
  | { action: "resume" }
  | { action: "skip" }
  | { action: "previous" }
  | { action: "set_shuffle"; on: boolean }
  | { action: "set_loop"; mode: LoopMode }
  | { action: "set_volume"; value: number }
  | { action: "set_rate"; value: number }
  | { action: "sleep_timer"; minutes?: number; end_of_song?: boolean; off?: boolean }
  | { action: "open"; target: "playlist"; playlist_id: number }
  | { action: "open"; target: "artist"; artist: string }
  | { action: "open"; target: "album"; artist: string | null; album: string }
  | { action: "open"; target: "liked" }
  | { action: "open"; target: "settings" };

/** Snapshot do leitor que acompanha cada mensagem (whitelist no servidor). */
export interface AssistantPlayerContext {
  song_id: number | null;
  title: string | null;
  artist: string | null;
  playing: boolean;
  volume: number;
  shuffle: boolean;
  loop_mode: LoopMode;
  rate: number;
  queue_length: number;
}

export interface AssistantChatSummary {
  id: number;
  title: string;
  last_message_at: string;
  read_only: boolean;
}

export interface AssistantChatDetail extends AssistantChatSummary {
  messages: AssistantMessage[];
}

export interface AssistantAnswer {
  reply: string;
  playlist?: { id: number; name: string; song_count: number } | null;
  /** Acções de leitor a executar localmente, já validadas pelo servidor. */
  actions?: AssistantAction[];
  /** O chat onde a mensagem ficou guardada (novo na primeira mensagem). */
  chat_id: number;
}

/** Só do próprio utilizador, ordenadas por last_message_at desc, sem messages. */
export const listAssistantChats = (): Promise<AssistantChatSummary[]> =>
  request("GET", "/music_assistant/chats");

/** 404 (nunca 403) se não existir ou for de outro utilizador. */
export const getAssistantChat = (id: number): Promise<AssistantChatDetail> =>
  request("GET", `/music_assistant/chats/${id}`);

export const deleteAssistantChat = (id: number): Promise<void> =>
  request("DELETE", `/music_assistant/chats/${id}`);

/** Sem `chatId` cria a sessão (o título nasce da primeira mensagem);
 *  com `chatId` apensa - 423 Locked se a sessão já for só de leitura. */
export const sendAssistantMessage = (
  message: string,
  chatId?: number,
  player?: AssistantPlayerContext,
): Promise<AssistantAnswer> =>
  request("POST", "/music_assistant", {
    body: {
      message,
      ...(chatId == null ? {} : { chat_id: chatId }),
      ...(player == null ? {} : { player }),
    },
    timeoutMs: 90_000,
  });
