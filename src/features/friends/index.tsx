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
import { useT } from "@/i18n";
import { useListeningStore } from "@/social/listeningStore";
import { useTheme } from "@/theme/provider";
import { EmptyState } from "@/ui";
import { FriendActivityRow } from "./rows";

export default function FriendsBody() {
  const t = useT();
  const { tokens } = useTheme();
  const friends = useListeningStore((s) => s.friends);

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingBottom: 24 }}
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
