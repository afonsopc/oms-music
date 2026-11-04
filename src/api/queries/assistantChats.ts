/**
 * "O Melhor Assistente" (3.8): o modelo propõe, o servidor valida - e desde
 * 2026-08-16 GUARDA as conversas. O cliente continua deliberadamente burro:
 * manda a mensagem nova (com `chatId` quando a sessão já existe) e o histórico
 * que alimenta o LLM é o DO SERVIDOR. Uma sessão cuja última mensagem tem mais
 * de 2 dias fica `read_only` e o POST responde 423.
 *
 * Desde 2026-08-21 o assistente também MANDA NO LEITOR: a resposta pode trazer
 * `actions` (já validadas e com as músicas serializadas pelo servidor) que a
 * app executa localmente, e o POST leva um snapshot do leitor.
 *
 * Sessões (dono, 2026-08-16): lista, detalhe com mensagens e apagar com
 * remoção optimista, no molde de queries/playlists.ts.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  MusicAssistantAction,
  MusicAssistantAnswer,
  MusicAssistantChatDetail,
  MusicAssistantChatSummary,
  MusicAssistantMessage,
  MusicAssistantPlayerContext,
} from "@omelhorsite/sdk";
import { ApiError } from "@/domain/api";
import type { Song } from "@/domain/song";
import { oms } from "../oms";
import { keys } from "../queryKeys";
import { guardedQueryFn } from "./common";
import { useAuthReady } from "@/auth/guard";

export type AssistantMessage = MusicAssistantMessage;
export type AssistantAction = MusicAssistantAction;
export type AssistantPlayerContext = MusicAssistantPlayerContext;
export type AssistantChatSummary = MusicAssistantChatSummary;
export type AssistantChatDetail = MusicAssistantChatDetail;

/** O SDK marca `chat_id` como opcional; o servidor manda-o sempre desde que
 *  guarda as conversas (2026-08-16), e o ecrã conta com ele. `songs` (ainda
 *  fora do SDK, 2026-09-23) são as músicas que a resposta CRIOU sem as pôr a
 *  tocar, p.ex. uma versão cortada: só para o chat as mostrar. */
export type AssistantAnswer = MusicAssistantAnswer & { chat_id: number; songs?: Song[] };

/** Sem `chatId` cria a sessão (o título nasce da primeira mensagem);
 *  com `chatId` apensa - 423 Locked se a sessão já for só de leitura. */
export const sendAssistantMessage = (
  message: string,
  chatId?: number,
  player?: AssistantPlayerContext,
): Promise<AssistantAnswer> =>
  oms().music.social.assistant.send({ message, chatId, player }) as Promise<AssistantAnswer>;

export const useAssistantChats = () => {
  const authReady = useAuthReady();
  const key = keys.assistantChats.list;
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, () => oms().music.social.assistant.chats.list()),
    enabled: authReady,
  });
};

/** 404 (nunca 403) se não existir ou for de outro utilizador. */
export const useAssistantChat = (id: number | null) => {
  const authReady = useAuthReady();
  const key = id != null ? keys.assistantChats.detail(id) : ["assistantChats", "detail", "none"];
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, () => oms().music.social.assistant.chats.get(id as number)),
    enabled: authReady && id != null,
  });
};

/** Optimistic delete: a conversa sai da lista no toque, volta se o servidor
 *  recusar. */
export const useDeleteAssistantChat = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => oms().music.social.assistant.chats.delete(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: keys.assistantChats.all });
      const previous = qc.getQueryData<AssistantChatSummary[]>(keys.assistantChats.list);
      if (previous) {
        qc.setQueryData(
          keys.assistantChats.list,
          previous.filter((chat) => chat.id !== id),
        );
      }
      return { previous };
    },
    onError: (_error, _id, context) => {
      if (context?.previous) qc.setQueryData(keys.assistantChats.list, context.previous);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.assistantChats.all });
    },
  });
};

// ----- 2026-11-04: stream, confirmar, desfazer, capacidades ------------------

/** O que o servidor diz enquanto trabalha ("A procurar na biblioteca…"). */
export interface AssistantProgress {
  type: "status" | "tool";
  text: string;
}

/** O que a resposta pode trazer além do contrato do SDK. */
export interface AssistantExtras {
  /** Uma pergunta de confirmação: o token vai no envio seguinte. */
  confirm?: { token: string; summary: string };
  /** O que esta resposta mexeu e se pode desfazer. */
  undo?: { snapshot_ids: number[] };
}

export type AssistantStreamAnswer = AssistantAnswer & AssistantExtras;

/**
 * POST /music_assistant/stream: o progresso chega em `onProgress` e a
 * resposta inteira no fim. Num servidor sem o stream (404/405) ou sem
 * leitura progressiva do corpo, cai no POST de sempre (o mesmo pedido, sem
 * progresso).
 */
export const streamAssistantMessage = async (
  message: string,
  opts: {
    chatId?: number;
    player?: AssistantPlayerContext;
    capabilities?: string[];
    confirm?: string;
    onProgress?: (progress: AssistantProgress) => void;
  },
): Promise<AssistantStreamAnswer> => {
  const { API_BASE_URL } = await import("../oms");
  const { isCookieAuth } = await import("@/auth/authMode");
  const { getToken } = await import("@/auth/token");
  const { fetch: expoFetch } = await import("expo/fetch");
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/x-ndjson" };
  const cookie = isCookieAuth();
  if (!cookie) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const body = JSON.stringify({
    message,
    chat_id: opts.chatId,
    player: opts.player,
    capabilities: opts.capabilities,
    confirm: opts.confirm,
  });
  const legacy = (): Promise<AssistantStreamAnswer> =>
    oms().http.post<AssistantStreamAnswer>(
      "/music_assistant",
      { message, chat_id: opts.chatId, player: opts.player, capabilities: opts.capabilities, confirm: opts.confirm },
      { retry: false, timeoutMs: 120000 },
    );

  const response = await expoFetch(`${API_BASE_URL}/music_assistant/stream`, {
    method: "POST",
    headers,
    body,
    credentials: cookie ? "include" : "omit",
  });
  if (response.status === 404 || response.status === 405) return legacy();
  if (!response.ok) throw new ApiError(response.status, `assistant ${response.status}`);
  if (!response.body) return legacy();

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: !done });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
      if (!line) continue;
      const event = JSON.parse(line) as
        | { type: "status" | "tool"; text: string }
        | { type: "done"; answer: AssistantStreamAnswer }
        | { type: "error"; status?: number; message?: string };
      if (event.type === "done") return event.answer;
      if (event.type === "error") {
        throw new ApiError(event.status ?? 502, event.message ?? "assistant error");
      }
      opts.onProgress?.(event);
    }
    if (done) break;
  }
  throw new ApiError(502, "assistant stream ended without an answer");
};
