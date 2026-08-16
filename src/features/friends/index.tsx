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
import { EmptyState } from "@/ui";
import { FriendActivityRow } from "./rows";

export default function FriendsBody({ standalone = false }: { standalone?: boolean }) {
  const t = useT();
  const { tokens } = useTheme();
  const friends = useListeningStore((s) => s.friends);
  const topPadding = useContentTopPadding();

  return (
    <ScrollView
      style={{ flex: 1 }}
      // The page form gets the top band on BOTH platforms; the right panel
      // tenant (RightPanel.tsx renders this same body) keeps its own 12px
      // frame, so the padding only applies standalone.
      //
      // `useContentTopPadding` already answers per platform (desktop band vs
      // insets.top + 16), so gating it on `desktop` as well was what put the
      // "Amigos" title under the dynamic island (owner report 2026-08-16,
      // point 13). The gate is a leftover from when this body was the 4th
      // page of the player pager and the pager paid the inset; as a pushed
      // screen it pays its own.
      contentContainerStyle={{
        paddingTop: standalone ? topPadding : 0,
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
