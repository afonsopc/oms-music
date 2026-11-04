/**
 * "O Melhor Assistente", raiz da tab (pedido do dono, 2026-08-21): a tab
 * abre DIRECTA num chat novo, sem lista pelo meio - falar é a acção
 * primária. A lista de sessões guardadas mudou-se para ./History.tsx,
 * atrás do botão de histórico no cabeçalho (a única acção do cabeçalho
 * desde o redesenho de 2026-11-04); "Nova conversa", no fim de uma
 * conversa, recomeça do zero (remount via key, o mesmo truque do [chatId]).
 *
 * A sessão nasce no servidor com a primeira mensagem (o ChatBody guarda o
 * chat_id devolvido), por isso sair da tab e voltar mantém a conversa em
 * curso - recomeçar é o "+", nunca a navegação.
 */
import React, { useState } from "react";
import { useRouter } from "expo-router";
import { useT } from "@/i18n";
import { haptics } from "@/lib/haptics";
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
      onNewChat={() => {
        haptics.select();
        setEpoch((n) => n + 1);
      }}
      headerAction={
        <GhostIconButton
          icon="history"
          size={22}
          color={tokens.foreground}
          accessibilityLabel={t(`${A}.historyTitle`)}
          onPress={() => {
            haptics.select();
            router.push(assistantHistoryRoute);
          }}
        />
      }
    />
  );
}
