/**
 * Friends panel (FR-119): the 4th page of the (player) pager, the fuller
 * counterpart of the Home strip. Every accepted friend who shares listening
 * appears here - live rows first, then by recency - including friends with
 * sharing off, who show presence without a song.
 *
 * The rows come from the FriendListeningChannel store (WP10 social layer);
 * nothing is fetched here. Before the channel is registered the store is
 * empty and the page renders its empty state, which is also the correct
 * state for an account with no listening friends.
 */
import React from "react";
import { ScrollView, Text, View } from "react-native";
import { useContentTopPadding } from "@/features/shell/metrics";
import { useT } from "@/i18n";
import { useListeningStore } from "@/social/listeningStore";
import { useTheme } from "@/theme/provider";
import { useDesktopShell } from "@/ui/shellLayout";
import { EmptyState } from "@/ui";
import { FriendActivityRow } from "./rows";

export default function FriendsBody({ standalone = false }: { standalone?: boolean }) {
  const t = useT();
  const { tokens } = useTheme();
  const friends = useListeningStore((s) => s.friends);
  const desktop = useDesktopShell();
  const topPadding = useContentTopPadding();

  return (
    <ScrollView
      style={{ flex: 1 }}
      // The page form gets the desktop shell's standard top band; the right
      // panel tenant (RightPanel.tsx renders this same body) keeps its own
      // 12px frame, so the padding only applies standalone. Mobile keeps the
      // shipped zero - the pushed screen draws right under the notch as it
      // always did.
      contentContainerStyle={{
        paddingTop: standalone && desktop ? topPadding : 0,
        paddingBottom: 24,
      }}
      showsVerticalScrollIndicator={false}
    >
      <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
        <Text style={{ color: tokens.foreground, fontSize: 22, fontWeight: "800" }}>
          {t("native.friends.title")}
        </Text>
      </View>
      {friends.length === 0 ? (
        <EmptyState icon="users" text={t("components.music.FriendActivityPanel.empty")} />
      ) : (
        friends.map((activity) => (
          <FriendActivityRow key={activity.user.id} activity={activity} />
        ))
      )}
    </ScrollView>
  );
}
