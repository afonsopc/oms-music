/**
 * O chat de UMA sessão do assistente (dono, 2026-08-16). O cliente continua
 * deliberadamente burro, mas o histórico deixou de morrer com o unmount:
 * vive no servidor. `chatId` "new" começa em branco e a sessão nasce na
 * primeira mensagem (o POST devolve `chat_id`); um id numérico carrega as
 * mensagens guardadas por GET. Numa sessão `read_only` (última mensagem há
 * mais de 2 dias) o composer desaparece e fica uma barra discreta com o
 * atalho "Nova conversa"; um 423 a meio (a janela fechou entre o GET e o
 * envio) invalida o detalhe e o remount ressincroniza do servidor, que é
 * quem sabe.
 *
 * Desde 2026-08-21 o assistente manda no leitor: cada envio leva um snapshot
 * do playerStore e cada resposta pode trazer `actions` validadas que
 * features/assistant/actions.ts executa (transport/engine/router). O ChatBody
 * também é o ecrã RAIZ da tab (via features/assistant/index.tsx), com os
 * botões de nova conversa e histórico em `headerActions`.
 *
 * As bolhas são estado LOCAL semeado do GET no initializer - sem efeito a
 * chamar setState (lint) - e o corpo é keyed pelo id da sessão. Depois de
 * cada resposta o cache do detalhe é actualizado à mão (setQueryData) para
 * que voltar atrás e reabrir dentro do staleTime não mostre a conversa sem
 * a troca mais recente.
 */
import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  sendAssistantMessage,
  type AssistantAnswer,
  type AssistantChatDetail,
} from "@/api/queries/assistantChats";
import { collectPlayerContext, runAssistantActions } from "@/features/assistant/actions";
import { useAssistantChat } from "@/api/queries/assistantChats";
import { keys } from "@/api/queryKeys";
import { isApiError } from "@/domain/api";
import { useContentBottomPadding, useContentTopPadding } from "@/features/shell/metrics";
import { useT } from "@/i18n";
import { assistantChatRoute, playlistRoute } from "@/lib/routes";
import { useTheme } from "@/theme/provider";
import { RADIUS } from "@/theme/tokens";
import { ErrorState, Icon } from "@/ui";

const A = "components.music.Assistant";

interface Bubble {
  role: "user" | "assistant";
  content: string;
  playlist?: AssistantAnswer["playlist"];
  error?: boolean;
}

export const ChatBody = ({
  chat,
  openedId,
  headerActions,
}: {
  chat: AssistantChatDetail | null;
  openedId: number | null;
  /** Botões do ecrã raiz (nova conversa, histórico), à direita do título. */
  headerActions?: React.ReactNode;
}) => {
  const t = useT();
  const router = useRouter();
  const { tokens } = useTheme();
  const queryClient = useQueryClient();
  const topPadding = useContentTopPadding(12);
  const bottomPadding = useContentBottomPadding();

  // A sessão que o servidor conhece: o id da rota, ou o `chat_id` que a
  // primeira resposta devolver quando se entra por "new".
  const [serverChatId, setServerChatId] = useState<number | null>(openedId);
  const [bubbles, setBubbles] = useState<Bubble[]>(() =>
    (chat?.messages ?? []).map((m) => ({ role: m.role, content: m.content })),
  );
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const readOnly = chat?.read_only ?? false;

  const send = useCallback(
    (raw: string): void => {
      const content = raw.trim();
      if (!content || pending || readOnly) return;
      setInput("");
      setPending(true);
      setBubbles((prev) => [...prev, { role: "user", content }]);
      sendAssistantMessage(content, serverChatId ?? undefined, collectPlayerContext())
        .then((answer) => {
          setServerChatId(answer.chat_id);
          setBubbles((prev) => [
            ...prev,
            { role: "assistant", content: answer.reply, playlist: answer.playlist },
          ]);
          // As acções de leitor vêm validadas do servidor; executar depois
          // de mostrar a resposta, para o texto explicar o que se ouve.
          runAssistantActions(answer.actions, router);
          // A lista ordena por last_message_at e a sessão pode ter acabado
          // de nascer: a tab tem de o saber.
          void queryClient.invalidateQueries({ queryKey: keys.assistantChats.list });
          // O detalhe em cache ganha a troca nova sem refetch: reabrir a
          // sessão dentro do staleTime já a mostra completa.
          if (openedId != null) {
            queryClient.setQueryData<AssistantChatDetail>(
              keys.assistantChats.detail(openedId),
              (prev) =>
                prev && {
                  ...prev,
                  last_message_at: new Date().toISOString(),
                  messages: [
                    ...prev.messages,
                    { role: "user", content },
                    { role: "assistant", content: answer.reply },
                  ],
                },
            );
          }
        })
        .catch((error: unknown) => {
          const locked = isApiError(error) && error.status === 423;
          if (locked && openedId != null) {
            // A janela fechou entre o GET e o envio: o refetch traz
            // read_only=true e o composer dá lugar à barra.
            void queryClient.invalidateQueries({
              queryKey: keys.assistantChats.detail(openedId),
            });
          }
          setBubbles((prev) => [
            ...prev,
            {
              role: "assistant",
              content: t(locked ? `${A}.readOnlyBar` : `${A}.error`),
              error: true,
            },
          ]);
        })
        .finally(() => {
          setPending(false);
          scrollRef.current?.scrollToEnd({ animated: true });
        });
    },
    [openedId, pending, queryClient, readOnly, router, serverChatId, t],
  );

  const suggestions = [
    t(`${A}.suggestionPlaylist`),
    t(`${A}.suggestionControl`),
    t(`${A}.suggestionHabits`),
    t(`${A}.suggestionForgotten`),
  ];

  return (
    <View style={{ flex: 1, backgroundColor: tokens.background }}>
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: topPadding,
          paddingBottom: 16,
          paddingHorizontal: 16,
          gap: 10,
        }}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <Text
            style={{
              color: tokens.foreground,
              fontSize: 28,
              fontWeight: "900",
              letterSpacing: -0.5,
              flex: 1,
              minWidth: 0,
            }}
            numberOfLines={2}
          >
            {chat?.title ?? t(`${A}.title`)}
          </Text>
          {headerActions ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              {headerActions}
            </View>
          ) : null}
        </View>
        {chat === null ? (
          <Text style={{ color: tokens.mutedForeground, fontSize: 14, lineHeight: 20 }}>
            {t(`${A}.subtitle`)}
          </Text>
        ) : null}

        {bubbles.length === 0 && !readOnly ? (
          <View style={{ gap: 8, marginTop: 12 }}>
            {suggestions.map((suggestion) => (
              <Pressable
                key={suggestion}
                accessibilityRole="button"
                onPress={() => send(suggestion)}
                style={({ pressed }) => ({
                  alignSelf: "flex-start",
                  paddingHorizontal: 14,
                  paddingVertical: 9,
                  borderRadius: 999,
                  backgroundColor: tokens.secondary,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Text style={{ color: tokens.secondaryForeground, fontSize: 13 }}>
                  {suggestion}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {bubbles.map((bubble, i) => (
          <View
            key={`b-${i}`}
            style={{
              alignSelf: bubble.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "85%",
              gap: 6,
            }}
          >
            <View
              style={{
                paddingHorizontal: 14,
                paddingVertical: 10,
                borderRadius: 16,
                backgroundColor:
                  bubble.role === "user"
                    ? tokens.primary
                    : bubble.error
                      ? tokens.destructive
                      : tokens.secondary,
              }}
            >
              <Text
                style={{
                  color:
                    bubble.role === "user"
                      ? tokens.primaryForeground
                      : bubble.error
                        ? tokens.destructiveForeground
                        : tokens.foreground,
                  fontSize: 14,
                  lineHeight: 20,
                }}
              >
                {bubble.content}
              </Text>
            </View>
            {bubble.playlist ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push(playlistRoute(bubble.playlist!.id))}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  padding: 12,
                  borderRadius: RADIUS,
                  borderWidth: 1,
                  borderColor: tokens.border,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Icon name="list-music" size={18} color={tokens.primary} />
                <View style={{ flexShrink: 1, minWidth: 0 }}>
                  <Text
                    style={{ color: tokens.foreground, fontSize: 14, fontWeight: "700" }}
                    numberOfLines={1}
                  >
                    {bubble.playlist.name}
                  </Text>
                  <Text style={{ color: tokens.mutedForeground, fontSize: 12 }}>
                    {t(`${A}.openPlaylist`, { count: bubble.playlist.song_count })}
                  </Text>
                </View>
                <Icon name="chevron-right" size={16} color={tokens.mutedForeground} />
              </Pressable>
            ) : null}
          </View>
        ))}
        {pending ? (
          <View style={{ alignSelf: "flex-start", padding: 10 }}>
            <ActivityIndicator color={tokens.mutedForeground} />
          </View>
        ) : null}
      </ScrollView>

      {readOnly ? (
        // Sessão antiga: sem composer, só a barra discreta com o atalho.
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            marginHorizontal: 16,
            marginTop: 8,
            marginBottom: bottomPadding + 8,
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderRadius: RADIUS,
            borderWidth: 1,
            borderColor: tokens.border,
          }}
        >
          <Icon name="clock" size={14} color={tokens.mutedForeground} />
          <Text
            style={{
              flex: 1,
              minWidth: 0,
              color: tokens.mutedForeground,
              fontSize: 12,
              lineHeight: 16,
            }}
          >
            {t(`${A}.readOnlyBar`)}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(assistantChatRoute("new"))}
            style={({ pressed }) => ({
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderRadius: 999,
              backgroundColor: tokens.secondary,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text
              style={{ color: tokens.secondaryForeground, fontSize: 12, fontWeight: "700" }}
            >
              {t(`${A}.newChat`)}
            </Text>
          </Pressable>
        </View>
      ) : (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingHorizontal: 16,
            paddingTop: 8,
            paddingBottom: bottomPadding + 8,
          }}
        >
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder={t(`${A}.placeholder`)}
            placeholderTextColor={tokens.mutedForeground}
            onSubmitEditing={() => send(input)}
            editable={!pending}
            style={{
              flex: 1,
              color: tokens.foreground,
              backgroundColor: tokens.secondary,
              borderRadius: 999,
              paddingHorizontal: 16,
              paddingVertical: 10,
              fontSize: 14,
            }}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(`${A}.send`)}
            onPress={() => send(input)}
            disabled={pending || input.trim().length === 0}
            style={({ pressed }) => ({
              width: 40,
              height: 40,
              borderRadius: 20,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: tokens.primary,
              opacity: pending || input.trim().length === 0 ? 0.4 : pressed ? 0.7 : 1,
            })}
          >
            <Icon name="chevron-right" size={18} color={tokens.primaryForeground} />
          </Pressable>
        </View>
      )}
    </View>
  );
};

export default function AssistantChatScreen() {
  const t = useT();
  const { tokens } = useTheme();
  const { chatId: chatIdParam } = useLocalSearchParams<{ chatId: string }>();
  const openedId = chatIdParam === "new" ? null : Number(chatIdParam);

  const chatQuery = useAssistantChat(openedId);

  if (openedId != null && chatQuery.data === undefined) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: tokens.background,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {chatQuery.isError ? (
          <ErrorState
            text={t(`${A}.chatLoadError`)}
            onRetry={() => void chatQuery.refetch()}
          />
        ) : (
          <ActivityIndicator color={tokens.mutedForeground} />
        )}
      </View>
    );
  }

  return (
    <ChatBody key={openedId ?? "new"} chat={chatQuery.data ?? null} openedId={openedId} />
  );
}
