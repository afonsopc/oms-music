/** "O Melhor Assistente" (3.8): o modelo propõe, o servidor valida - e desde
 *  2026-08-16 GUARDA as conversas. O cliente continua deliberadamente burro:
 *  manda a mensagem nova (com `chat_id` quando a sessão já existe) e o
 *  histórico que alimenta o LLM é o DO SERVIDOR. Uma sessão cuja última
 *  mensagem tem mais de 2 dias fica `read_only` e o POST responde 423. */
import { request } from "../client";

export interface AssistantMessage {
  role: "user" | "assistant";
  content: string;
  created_at?: string;
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
): Promise<AssistantAnswer> =>
  request("POST", "/music_assistant", {
    body: chatId == null ? { message } : { chat_id: chatId, message },
    timeoutMs: 90_000,
  });
