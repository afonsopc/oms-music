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
 *  guarda as conversas (2026-08-16), e o ecrã conta com ele. */
export type AssistantAnswer = MusicAssistantAnswer & { chat_id: number };

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
