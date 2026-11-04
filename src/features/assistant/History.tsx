/**
 * O histórico de conversas do assistente (2026-08-21). Era a RAIZ da tab
 * (2026-08-16), no molde visual da lista de playlists (linhas outline
 * full-width, acção primária no cabeçalho, empty state que oferece a
 * primeira conversa); a raiz passou a ser um chat novo (pedido do dono) e a
 * lista mudou-se para este ecrã empurrado, atrás do botão de histórico.
 * Cada linha abre o chat da sessão; uma sessão cuja última mensagem tem
 * mais de 2 dias vem `read_only` do servidor e ganha o selo "Só de leitura".
 *
 * Redesenho 2026-11-04: o cabeçalho comum com uma acção (nova conversa),
 * linhas finas (ListRow), esqueleto enquanto carrega, e apagar é optimista:
 * a linha sai no toque e volta se o servidor recusar.
 */
import React, { useCallback, useMemo, useState } from "react";
import { FlatList, View } from "react-native";
import { useRouter } from "expo-router";
import { useAssistantChats, useDeleteAssistantChat } from "@/api/queries/assistantChats";
import type { AssistantChatSummary } from "@/api/queries/assistantChats";
import { timeAgo } from "@/features/friends/rows";
import { useContentBottomPadding, useContentTopPadding } from "@/features/shell/metrics";
import { useT } from "@/i18n";
import { haptics } from "@/lib/haptics";
import { assistantChatRoute } from "@/lib/routes";
import { useTheme } from "@/theme/provider";
import { ConfirmDialog, GhostIconButton } from "@/ui";
import { Reveal } from "@/ui/motion";
import { ListRow, ListSkeleton, PageHeader, PageState, useGutter } from "@/ui/page";

const A = "components.music.Assistant";

const ChatRow = React.memo(function ChatRow({
  chat,
  order,
  onOpen,
  onDelete,
}: {
  chat: AssistantChatSummary;
  order: number;
  onOpen: (chat: AssistantChatSummary) => void;
  onDelete: (chat: AssistantChatSummary) => void;
}) {
  const { tokens } = useTheme();
  const t = useT();
  const gutter = useGutter();
  const ago = timeAgo(chat.last_message_at, t);
  const meta = [ago, chat.read_only ? t(`${A}.readOnlyBadge`) : null].filter(Boolean).join(" · ");
  // A linha e o caixote sao irmaos, nao um dentro do outro (um botao
  // dentro de outro e HTML invalido na web).
  return (
    <Reveal order={order < 12 ? order : 0} duration={order < 12 ? 300 : 1}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingRight: gutter - 8 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <ListRow
            title={chat.title}
            meta={meta || null}
            icon="sparkles"
            last
            onPress={() => onOpen(chat)}
            onLongPress={() => {
              haptics.press();
              onDelete(chat);
            }}
          />
        </View>
        <GhostIconButton
          icon="trash"
          size={18}
          color={tokens.mutedForeground}
          accessibilityLabel={t(`${A}.deleteChat`)}
          onPress={() => onDelete(chat)}
        />
      </View>
      <View style={{ height: 1, marginLeft: gutter, backgroundColor: tokens.border }} />
    </Reveal>
  );
});

export default function AssistantHistoryScreen() {
  const t = useT();
  const { tokens } = useTheme();
  const router = useRouter();
  const bottomPadding = useContentBottomPadding();
  const topPadding = useContentTopPadding(12);
  const [toDelete, setToDelete] = useState<AssistantChatSummary | null>(null);
  // Apagadas no toque, antes da resposta do servidor (voltam se falhar).
  const [hidden, setHidden] = useState<ReadonlySet<number>>(() => new Set());

  const chatsQuery = useAssistantChats();
  const deleteMutation = useDeleteAssistantChat();
  const chats = useMemo(
    () => (chatsQuery.data ?? []).filter((chat) => !hidden.has(chat.id)),
    [chatsQuery.data, hidden],
  );

  const startNew = useCallback(() => {
    haptics.select();
    router.push(assistantChatRoute("new"));
  }, [router]);

  const onOpen = useCallback(
    (chat: AssistantChatSummary) => {
      haptics.select();
      router.push(assistantChatRoute(chat.id));
    },
    [router],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: AssistantChatSummary; index: number }) => (
      <ChatRow chat={item} order={index} onOpen={onOpen} onDelete={setToDelete} />
    ),
    [onOpen],
  );

  const header = (
    <PageHeader
      title={t(`${A}.historyTitle`)}
      style={{ paddingBottom: 12 }}
      trailing={
        <GhostIconButton
          icon="plus"
          size={22}
          color={tokens.foreground}
          accessibilityLabel={t(`${A}.newChat`)}
          onPress={startNew}
        />
      }
    />
  );

  const empty = (
    <PageState
      loading={chatsQuery.isPending}
      error={chatsQuery.isError ? chatsQuery.error : undefined}
      onRetry={() => void chatsQuery.refetch()}
      skeleton={<ListSkeleton rows={8} artwork={false} />}
      empty
      emptyIcon="sparkles"
      emptyText={t(`${A}.listEmpty`)}
      emptyActionLabel={t(`${A}.newChat`)}
      onEmptyAction={startNew}
    />
  );

  return (
    <View style={{ flex: 1, backgroundColor: tokens.background }}>
      <FlatList
        data={chats}
        renderItem={renderItem}
        keyExtractor={(item) => String(item.id)}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        initialNumToRender={12}
        windowSize={9}
        removeClippedSubviews
        contentContainerStyle={{ paddingTop: topPadding, paddingBottom: bottomPadding }}
      />
      <ConfirmDialog
        visible={toDelete !== null}
        title={t(`${A}.deleteChat`)}
        message={t(`${A}.deleteChatConfirm`)}
        confirmLabel={t(`${A}.deleteChat`)}
        destructive
        onCancel={() => setToDelete(null)}
        onConfirm={() => {
          if (toDelete === null) return;
          const id = toDelete.id;
          setToDelete(null);
          setHidden((prev) => new Set(prev).add(id));
          haptics.success();
          deleteMutation.mutate(id, {
            onError: () => {
              haptics.error();
              setHidden((prev) => {
                const next = new Set(prev);
                next.delete(id);
                return next;
              });
            },
          });
        }}
      />
    </View>
  );
}
