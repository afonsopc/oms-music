/**
 * "O Melhor Assistente", raiz da tab (pedido do dono, 2026-08-21): a tab
 * abre DIRECTA num chat novo, sem lista pelo meio - falar é a acção
 * primária. A lista de sessões guardadas mudou-se para ./History.tsx,
 * atrás do botão de histórico no cabeçalho; o botão "+" recomeça do zero
 * (remount via key, o mesmo truque do [chatId]).
 *
 * A sessão nasce no servidor com a primeira mensagem (o ChatBody guarda o
 * chat_id devolvido), por isso sair da tab e voltar mantém a conversa em
 * curso - recomeçar é o "+", nunca a navegação.
 */
import React, { useState } from "react";
import { useRouter } from "expo-router";
import { useT } from "@/i18n";
import { assistantHistoryRoute } from "@/lib/routes";
import { useTheme } from "@/theme/provider";
import { GhostIconButton } from "@/ui";
import { ChatBody } from "./Chat";

const A = "components.music.Assistant";

export default function AssistantHomeScreen() {
  const t = useT();
  const { tokens } = useTheme();
  const router = useRouter();
  // Incrementar remonta o ChatBody em branco: um chat novo a sério.
  const [epoch, setEpoch] = useState(0);

  return (
    <ChatBody
      key={epoch}
      chat={null}
      openedId={null}
      headerActions={
        <>
          <GhostIconButton
            icon="plus"
            size={20}
            color={tokens.mutedForeground}
            accessibilityLabel={t(`${A}.newChat`)}
            onPress={() => setEpoch((n) => n + 1)}
          />
          <GhostIconButton
            icon="history"
            size={20}
            color={tokens.mutedForeground}
            accessibilityLabel={t(`${A}.historyTitle`)}
            onPress={() => router.push(assistantHistoryRoute)}
          />
        </>
      }
    />
  );
}
