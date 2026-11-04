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
 *
 * Redesenho 2026-11-04 (docs/redesenho.md): o cabeçalho comum (PageHeader,
 * uma acção só: o histórico), as sugestões em linhas de lista em vez de
 * pílulas, o que ele responde em texto corrido e o que tu escreves num
 * balão cinzento; a espera é um esqueleto, nunca um spinner solto.
 */
import React, { useCallback, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  streamAssistantMessage,
  type AssistantAnswer,
  type AssistantChatDetail,
  type AssistantStreamAnswer,
} from "@/api/queries/assistantChats";
import {
  collectPlayerContext,
  runAssistantActions,
  type AnyAssistantAction,
} from "@/features/assistant/actions";
import { assistantCapabilities } from "@/features/assistant/capabilities";
import { useAssistantChat } from "@/api/queries/assistantChats";
import { keys } from "@/api/queryKeys";
import { isApiError } from "@/domain/api";
import { songArtworkSource } from "@/domain/artwork";
import { formatArtists } from "@/domain/format";
import type { Song } from "@/domain/song";
import { useContentBottomPadding, useContentTopPadding } from "@/features/shell/metrics";
import { useT } from "@/i18n";
import { haptics } from "@/lib/haptics";
import { assistantChatRoute, playlistRoute } from "@/lib/routes";
import { useTheme } from "@/theme/provider";
import { ArtworkImage, Icon, Skeleton } from "@/ui";
import { Reveal } from "@/ui/motion";
import { ListRow, PageHeader, PageState, pageType, TextButton, useGutter, WaitHint } from "@/ui/page";

const A = "components.music.Assistant";
/** Quantas musicas o cartao mostra antes de contar as que faltam. */
const SONGS_SHOWN = 4;

interface Bubble {
  role: "user" | "assistant";
  content: string;
  playlist?: AssistantAnswer["playlist"];
  /**
   * As musicas que ESTA resposta pos a tocar ou na fila. O assistente
   * escrevia-as no texto (e chegou a copiar a ficha interna com ids e
   * barras, dono 2026-08-31); mostra-las e trabalho da app, nao dele.
   */
  songs?: Song[];
  error?: boolean;
  /** Uma pergunta antes de tirar coisas: Confirmar manda o token. */
  confirm?: AssistantStreamAnswer["confirm"];
  /** Esta resposta mexeu em playlists ou gostos: dá para desfazer. */
  undoable?: boolean;
}

/**
 * As musicas de uma resposta, pela ordem das accoes, sem repetidas; depois
 * as que ela criou sem tocar (uma versao cortada).
 */
const songsOf = (answer: Pick<AssistantAnswer, "actions" | "songs">): Song[] => {
  const seen = new Set<number>();
  const songs: Song[] = [];
  const add = (song: Song): void => {
    if (seen.has(song.id)) return;
    seen.add(song.id);
    songs.push(song);
  };
  for (const action of answer.actions ?? []) {
    if (action.action !== "play" && action.action !== "queue") continue;
    for (const song of action.songs as unknown as Song[]) add(song);
  }
  for (const song of answer.songs ?? []) add(song);
  return songs;
};

export const ChatBody = ({
  chat,
  openedId,
  headerAction,
  onNewChat,
}: {
  chat: AssistantChatDetail | null;
  openedId: number | null;
  /** A acção do ecrã raiz (o histórico), à direita do título. */
  headerAction?: React.ReactNode;
  /** "Nova conversa" no fim de uma conversa; por omissão abre uma nova rota. */
  onNewChat?: () => void;
}) => {
  const t = useT();
  const router = useRouter();
  const { tokens, setMode } = useTheme();
  const queryClient = useQueryClient();
  const gutter = useGutter();
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
  // O que o servidor diz enquanto trabalha ("A procurar na biblioteca…").
  const [progress, setProgress] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const readOnly = chat?.read_only ?? false;

  const send = useCallback(
    (raw: string, confirmToken?: string): void => {
      const content = raw.trim();
      if (!content || pending || readOnly) return;
      haptics.select();
      setInput("");
      setPending(true);
      setProgress(null);
      // Uma pergunta respondida deixa de ter botões.
      setBubbles((prev) => [
        ...prev.map((b) => (b.confirm ? { ...b, confirm: undefined } : b)),
        { role: "user", content },
      ]);
      streamAssistantMessage(content, {
        chatId: serverChatId ?? undefined,
        player: collectPlayerContext(),
        capabilities: assistantCapabilities(),
        confirm: confirmToken,
        onProgress: (p) => setProgress(p.text),
      })
        .then((answer) => {
          setServerChatId(answer.chat_id);
          haptics.success();
          setBubbles((prev) => [
            ...prev,
            {
              role: "assistant",
              content: answer.reply,
              playlist: answer.playlist,
              songs: songsOf(answer),
              confirm: answer.confirm,
              undoable: (answer.undo?.snapshot_ids.length ?? 0) > 0,
            },
          ]);
          // As acções de leitor vêm validadas do servidor; executar depois
          // de mostrar a resposta, para o texto explicar o que se ouve.
          runAssistantActions(answer.actions as AnyAssistantAction[] | undefined, router, {
            setThemeMode: setMode,
            onImportError: () =>
              setBubbles((prev) => [
                ...prev,
                { role: "assistant", content: t(`${A}.importFailed`), error: true },
              ]),
          });
          if (answer.playlist) void queryClient.invalidateQueries({ queryKey: keys.playlists.all });
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
          haptics.error();
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
          setProgress(null);
          scrollRef.current?.scrollToEnd({ animated: true });
        });
    },
    [openedId, pending, queryClient, readOnly, router, serverChatId, setMode, t],
  );

  const suggestions = [
    t(`${A}.suggestionPlaylist`),
    t(`${A}.suggestionControl`),
    t(`${A}.suggestionHabits`),
    t(`${A}.suggestionForgotten`),
  ];
  const newChat = onNewChat ?? (() => router.push(assistantChatRoute("new")));
  const canSend = !pending && input.trim().length > 0;

  return (
    <View style={{ flex: 1, backgroundColor: tokens.background }}>
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: topPadding, paddingBottom: 16 }}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        <PageHeader title={chat?.title ?? t(`${A}.title`)} trailing={headerAction} />

        {bubbles.length === 0 && !readOnly ? (
          // As sugestões são linhas da lista, não pílulas: tocar envia.
          <View style={{ marginTop: 16 }}>
            {suggestions.map((suggestion, i) => (
              <ListRow
                key={suggestion}
                title={suggestion}
                chevron
                order={i}
                last={i === suggestions.length - 1}
                onPress={() => send(suggestion)}
              />
            ))}
          </View>
        ) : null}

        <View style={{ paddingHorizontal: gutter, gap: 18, marginTop: bubbles.length > 0 ? 20 : 0 }}>
          {bubbles.map((bubble, i) =>
            bubble.role === "user" ? (
              <Reveal key={`b-${i}`} distance={8} duration={220}>
                <View
                  style={{
                    alignSelf: "flex-end",
                    maxWidth: "85%",
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    borderRadius: 18,
                    backgroundColor: tokens.secondary,
                  }}
                >
                  <Text style={[pageType.body, { color: tokens.foreground }]}>{bubble.content}</Text>
                </View>
              </Reveal>
            ) : (
              <Reveal key={`b-${i}`} distance={8} duration={260}>
                <View style={{ gap: 12 }}>
                  {bubble.error ? (
                    <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
                      <Icon name="alert-circle" size={18} color={tokens.mutedForeground} />
                      <Text style={[pageType.body, { color: tokens.mutedForeground, flex: 1 }]}>
                        {bubble.content}
                      </Text>
                    </View>
                  ) : (
                    <Text style={[pageType.body, { color: tokens.foreground, lineHeight: 23 }]}>
                      {bubble.content}
                    </Text>
                  )}
                  {bubble.songs && bubble.songs.length > 0 ? (
                    <View style={{ gap: 10 }}>
                      {bubble.songs.slice(0, SONGS_SHOWN).map((song) => (
                        <View
                          key={song.id}
                          style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
                        >
                          <ArtworkImage source={songArtworkSource(song)} songId={song.id} size={44} />
                          <View style={{ flexShrink: 1, minWidth: 0 }}>
                            <Text
                              numberOfLines={1}
                              style={[pageType.body, { color: tokens.foreground, fontWeight: "500" }]}
                            >
                              {song.title}
                            </Text>
                            <Text
                              numberOfLines={1}
                              style={[pageType.meta, { color: tokens.mutedForeground }]}
                            >
                              {formatArtists(song)}
                            </Text>
                          </View>
                        </View>
                      ))}
                      {bubble.songs.length > SONGS_SHOWN ? (
                        <Text style={[pageType.meta, { color: tokens.mutedForeground }]}>
                          {t(`${A}.moreSongs`, { count: bubble.songs.length - SONGS_SHOWN })}
                        </Text>
                      ) : null}
                    </View>
                  ) : null}
                  {bubble.playlist ? (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        haptics.select();
                        router.push(playlistRoute(bubble.playlist!.id));
                      }}
                      style={({ pressed }) => ({
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 12,
                        minHeight: 56,
                        borderTopWidth: 1,
                        borderBottomWidth: 1,
                        borderColor: tokens.border,
                        backgroundColor: pressed ? tokens.secondary : "transparent",
                      })}
                    >
                      <Icon name="list-music" size={20} color={tokens.mutedForeground} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text
                          style={[pageType.body, { color: tokens.foreground, fontWeight: "600" }]}
                          numberOfLines={1}
                        >
                          {bubble.playlist.name}
                        </Text>
                        <Text style={[pageType.meta, { color: tokens.mutedForeground }]}>
                          {t(`${A}.openPlaylist`, { count: bubble.playlist.song_count })}
                        </Text>
                      </View>
                      <Icon name="chevron-right" size={18} color={tokens.mutedForeground} />
                    </Pressable>
                  ) : null}
                  {bubble.confirm ? (
                    <View style={{ flexDirection: "row", gap: 16 }}>
                      <TextButton
                        label={t(`${A}.confirm`)}
                        icon="check"
                        onPress={() => send(t(`${A}.confirmYes`), bubble.confirm!.token)}
                      />
                      <TextButton label={t(`${A}.cancel`)} onPress={() => send(t(`${A}.confirmNo`))} />
                    </View>
                  ) : null}
                  {bubble.undoable && i === bubbles.length - 1 && !pending ? (
                    <View style={{ flexDirection: "row" }}>
                      <TextButton label={t(`${A}.undo`)} icon="history" onPress={() => send(t(`${A}.undoMessage`))} />
                    </View>
                  ) : null}
                </View>
              </Reveal>
            ),
          )}

          {pending ? (
            // A resposta a caminho: linhas a brilhar onde o texto vai cair.
            <View style={{ gap: 8 }}>
              <Skeleton width="82%" height={13} />
              <Skeleton width="68%" height={13} />
              <Skeleton width="44%" height={13} />
              {progress ? (
                <Text style={[pageType.meta, { color: tokens.mutedForeground, paddingVertical: 4 }]}>
                  {progress}
                </Text>
              ) : (
                <WaitHint active style={{ alignItems: "flex-start", paddingVertical: 4 }} />
              )}
            </View>
          ) : null}

          {bubbles.length > 0 && !pending && !readOnly ? (
            <View style={{ flexDirection: "row" }}>
              <TextButton label={t(`${A}.newChat`)} icon="plus" onPress={newChat} />
            </View>
          ) : null}
        </View>
      </ScrollView>

      {readOnly ? (
        // Sessão antiga: sem composer, só uma linha com o atalho.
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            paddingHorizontal: gutter,
            paddingTop: 12,
            paddingBottom: bottomPadding + 8,
            borderTopWidth: 1,
            borderTopColor: tokens.border,
          }}
        >
          <Icon name="clock" size={16} color={tokens.mutedForeground} />
          <Text style={[pageType.meta, { flex: 1, minWidth: 0, color: tokens.mutedForeground }]}>
            {t(`${A}.readOnlyBar`)}
          </Text>
          <TextButton label={t(`${A}.newChat`)} onPress={newChat} />
        </View>
      ) : (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingHorizontal: gutter,
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
              minWidth: 0,
              height: 44,
              color: tokens.foreground,
              backgroundColor: tokens.secondary,
              borderRadius: 22,
              paddingHorizontal: 16,
              fontSize: 16,
            }}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(`${A}.send`)}
            onPress={() => send(input)}
            disabled={!canSend}
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: canSend ? tokens.primary : tokens.secondary,
              transform: [{ scale: pressed ? 0.94 : 1 }],
            })}
          >
            <Icon
              name="chevron-right"
              size={18}
              color={canSend ? tokens.primaryForeground : tokens.mutedForeground}
            />
          </Pressable>
        </View>
      )}
    </View>
  );
};

/** O esqueleto de uma conversa a abrir: título, um balão, uma resposta. */
const ChatSkeleton = () => {
  const gutter = useGutter();
  return (
    <View style={{ paddingHorizontal: gutter, gap: 22 }}>
      <Skeleton width="55%" height={28} />
      <Skeleton width="48%" height={40} borderRadius={18} style={{ alignSelf: "flex-end" }} />
      <View style={{ gap: 8 }}>
        <Skeleton width="86%" height={13} />
        <Skeleton width="72%" height={13} />
        <Skeleton width="40%" height={13} />
      </View>
      <Skeleton width="36%" height={40} borderRadius={18} style={{ alignSelf: "flex-end" }} />
      <View style={{ gap: 8 }}>
        <Skeleton width="80%" height={13} />
        <Skeleton width="58%" height={13} />
      </View>
    </View>
  );
};

export default function AssistantChatScreen() {
  const { tokens } = useTheme();
  const { chatId: chatIdParam } = useLocalSearchParams<{ chatId: string }>();
  const openedId = chatIdParam === "new" ? null : Number(chatIdParam);

  const chatQuery = useAssistantChat(openedId);

  const topPadding = useContentTopPadding(12);

  if (openedId != null && chatQuery.data === undefined) {
    return (
      <View style={{ flex: 1, backgroundColor: tokens.background, paddingTop: topPadding }}>
        <PageState
          loading={!chatQuery.isError}
          error={chatQuery.isError ? chatQuery.error : undefined}
          onRetry={() => void chatQuery.refetch()}
          skeleton={<ChatSkeleton />}
        />
      </View>
    );
  }

  return (
    <ChatBody key={openedId ?? "new"} chat={chatQuery.data ?? null} openedId={openedId} />
  );
}
