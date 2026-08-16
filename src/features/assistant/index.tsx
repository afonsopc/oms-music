/**
 * "O Melhor Assistente", agora uma TAB (dono, 2026-08-16): esta raiz é a
 * lista de sessões guardadas no servidor, no molde visual da lista de
 * playlists (linhas outline full-width, acção primária no cabeçalho, empty
 * state que oferece a primeira conversa). Cada linha abre o chat da sessão;
 * uma sessão cuja última mensagem tem mais de 2 dias vem `read_only` do
 * servidor e ganha o selo "Só de leitura". O chat em si vive em ./Chat.tsx.
 */
import React, { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useAssistantChats, useDeleteAssistantChat } from "@/api/queries/assistantChats";
import type { AssistantChatSummary } from "@/api/endpoints/assistant";
import { timeAgo } from "@/features/friends/rows";
import { useContentBottomPadding, useContentTopPadding } from "@/features/shell/metrics";
import { useT } from "@/i18n";
import { assistantChatRoute } from "@/lib/routes";
import { useTheme } from "@/theme/provider";
import { RADIUS } from "@/theme/tokens";
import { ConfirmDialog, EmptyState, ErrorState, GhostIconButton, Icon } from "@/ui";

const A = "components.music.Assistant";

const ChatRow = ({
  chat,
  onPress,
  onDelete,
}: {
  chat: AssistantChatSummary;
  onPress: () => void;
  onDelete: () => void;
}) => {
  const { tokens } = useTheme();
  const t = useT();
  const ago = timeAgo(chat.last_message_at, t);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={chat.title}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        padding: 12,
        borderWidth: 1,
        borderColor: tokens.border,
        borderRadius: RADIUS,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: tokens.secondary,
        }}
      >
        <Icon name="sparkles" size={20} color={tokens.primary} />
      </View>
      {/* minWidth 0 lets a long title truncate instead of stretching the row. */}
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text
          style={{ color: tokens.foreground, fontSize: 15, fontWeight: "700" }}
          numberOfLines={2}
        >
          {chat.title}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {ago ? (
            <Text style={{ color: tokens.mutedForeground, fontSize: 12 }} numberOfLines={1}>
              {ago}
            </Text>
          ) : null}
          {chat.read_only ? (
            <View
              style={{
                paddingHorizontal: 8,
                paddingVertical: 2,
                borderRadius: 999,
                backgroundColor: tokens.secondary,
              }}
            >
              <Text
                style={{ color: tokens.secondaryForeground, fontSize: 10, fontWeight: "700" }}
              >
                {t(`${A}.readOnlyBadge`)}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
      <GhostIconButton
        icon="trash"
        size={16}
        color={tokens.mutedForeground}
        accessibilityLabel={t(`${A}.deleteChat`)}
        onPress={onDelete}
      />
      <Icon name="chevron-right" size={16} color={tokens.mutedForeground} />
    </Pressable>
  );
};

export default function AssistantSessionsScreen() {
  const t = useT();
  const { tokens } = useTheme();
  const router = useRouter();
  const bottomPadding = useContentBottomPadding();
  const topPadding = useContentTopPadding(20);
  const [toDelete, setToDelete] = useState<AssistantChatSummary | null>(null);

  const chatsQuery = useAssistantChats();
  const deleteMutation = useDeleteAssistantChat();
  const chats = chatsQuery.data ?? [];

  const startNew = useCallback(
    () => router.push(assistantChatRoute("new")),
    [router],
  );

  const renderItem = useCallback(
    ({ item }: { item: AssistantChatSummary }) => (
      <ChatRow
        chat={item}
        onPress={() => router.push(assistantChatRoute(item.id))}
        onDelete={() => setToDelete(item)}
      />
    ),
    [router],
  );

  const header = (
    <View style={{ gap: 6, paddingBottom: 16 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <Text
          style={{ color: tokens.foreground, fontSize: 24, fontWeight: "800", flex: 1 }}
          numberOfLines={1}
        >
          {t(`${A}.title`)}
        </Text>
        <Pressable
          onPress={startNew}
          accessibilityRole="button"
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingHorizontal: 16,
            paddingVertical: 10,
            borderRadius: 999,
            backgroundColor: tokens.primary,
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <Icon name="plus" size={16} color={tokens.primaryForeground} />
          <Text style={{ color: tokens.primaryForeground, fontWeight: "700", fontSize: 14 }}>
            {t(`${A}.newChat`)}
          </Text>
        </Pressable>
      </View>
      <Text style={{ color: tokens.mutedForeground, fontSize: 13, lineHeight: 18 }}>
        {t(`${A}.subtitle`)}
      </Text>
    </View>
  );

  const empty = chatsQuery.isLoading ? (
    <View style={{ paddingVertical: 40 }}>
      <ActivityIndicator />
    </View>
  ) : chatsQuery.isError ? (
    <ErrorState text={t(`${A}.listError`)} onRetry={() => void chatsQuery.refetch()} />
  ) : (
    <EmptyState
      icon="sparkles"
      text={t(`${A}.listEmpty`)}
      actionLabel={t(`${A}.newChat`)}
      onAction={startNew}
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
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        initialNumToRender={12}
        windowSize={9}
        removeClippedSubviews
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: topPadding,
          paddingBottom: bottomPadding,
        }}
      />
      <ConfirmDialog
        visible={toDelete !== null}
        title={t(`${A}.deleteChat`)}
        message={t(`${A}.deleteChatConfirm`)}
        confirmLabel={t(`${A}.deleteChat`)}
        destructive
        pending={deleteMutation.isPending}
        onCancel={() => setToDelete(null)}
        onConfirm={() => {
          if (toDelete === null) return;
          deleteMutation.mutate(toDelete.id, {
            onSettled: () => setToDelete(null),
          });
        }}
      />
    </View>
  );
}
