/**
 * Notifications (ticket #55): what came into the library and whether it went
 * well, without leaving the app. Tapping an added song opens it.
 */
import React from "react";
import { FlatList, RefreshControl, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { useMusicNotifications } from "@/api/queries/notifications";
import { useContentBottomPadding, useContentTopPadding } from "@/features/shell/metrics";
import { useLocale, useT } from "@/i18n";
import { formatDateTime } from "@/lib/dates";
import type { MusicNotification } from "@/social/musicNotifications";
import { useTheme } from "@/theme/provider";
import { Icon } from "@/ui";
import { PressableScale } from "@/ui/motion";
import { PageState, PageTitle, useGutter } from "@/ui/page";

const Row = ({ item }: { item: MusicNotification }) => {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const gutter = useGutter();
  const { tokens, ink } = useTheme();
  const failed = item.tone === "failed";
  return (
    <PressableScale
      disabled={item.songId == null}
      accessibilityRole="button"
      onPress={() => {
        if (item.songId != null) router.push(`/song/${item.songId}` as Href);
      }}
      style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: gutter, paddingVertical: 12 }}
    >
      <Icon name={failed ? "alert-circle" : "circle-check"} size={20} color={failed ? ink.destructive : ink.success} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text numberOfLines={2} style={{ color: tokens.foreground, fontSize: 15, lineHeight: 20 }}>
          {t(`native.notifications.${item.key}`, item.params)}
        </Text>
        <Text style={{ color: tokens.mutedForeground, fontSize: 13 }}>{formatDateTime(item.createdAt, locale)}</Text>
      </View>
      {item.songId != null ? <Icon name="chevron-right" size={16} color={tokens.mutedForeground} /> : null}
    </PressableScale>
  );
};

export default function NotificationsScreen() {
  const t = useT();
  const gutter = useGutter();
  const { tokens } = useTheme();
  const topPadding = useContentTopPadding();
  const bottomPadding = useContentBottomPadding();
  const query = useMusicNotifications();
  return (
    <FlatList
      style={{ flex: 1, backgroundColor: tokens.background }}
      data={query.data ?? []}
      keyExtractor={(item) => String(item.id)}
      renderItem={({ item }) => <Row item={item} />}
      contentContainerStyle={{ paddingTop: topPadding, paddingBottom: bottomPadding }}
      refreshControl={
        <RefreshControl
          refreshing={query.isRefetching}
          onRefresh={() => void query.refetch()}
          tintColor={tokens.mutedForeground}
        />
      }
      ListHeaderComponent={
        <View style={{ paddingHorizontal: gutter, paddingBottom: 12 }}>
          <PageTitle>{t("native.notifications.title")}</PageTitle>
        </View>
      }
      ListEmptyComponent={
        <PageState
          loading={query.isLoading}
          error={query.isError}
          empty
          emptyIcon="music"
          emptyText={t("native.notifications.empty")}
          onRetry={() => void query.refetch()}
        />
      }
    />
  );
}
