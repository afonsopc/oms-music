/** Sessões do assistente (dono, 2026-08-16): lista, detalhe com mensagens e
 *  apagar com remoção optimista, no molde de queries/playlists.ts. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteAssistantChat,
  getAssistantChat,
  listAssistantChats,
  type AssistantChatSummary,
} from "../endpoints/assistant";
import { keys } from "../queryKeys";
import { guardedQueryFn } from "./common";
import { useAuthReady } from "@/auth/guard";

export const useAssistantChats = () => {
  const authReady = useAuthReady();
  const key = keys.assistantChats.list;
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, () => listAssistantChats()),
    enabled: authReady,
  });
};

export const useAssistantChat = (id: number | null) => {
  const authReady = useAuthReady();
  const key = id != null ? keys.assistantChats.detail(id) : ["assistantChats", "detail", "none"];
  return useQuery({
    queryKey: key,
    queryFn: guardedQueryFn(key, () => getAssistantChat(id as number)),
    enabled: authReady && id != null,
  });
};

/** Optimistic delete: a conversa sai da lista no toque, volta se o servidor
 *  recusar. */
export const useDeleteAssistantChat = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteAssistantChat(id),
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
