/**
 * Friends panel (FR-119): the 4th page of the (player) pager, the fuller
 * counterpart of the Home strip. Every accepted friend who shares listening
 * appears here - live rows first, then by recency - including friends with
 * sharing off, who show presence without a song.
 *
 * The rows come from the FriendListeningChannel store (WP10 social layer);
 * nothing is fetched here. Until the channel confirms (or a few seconds
 * pass) the page shows row skeletons; after that an empty roster is the
 * empty state, also the correct state for an account with no listening
 * friends.
 */
import React, { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useContentBottomPadding, useContentTopPadding } from "@/features/shell/metrics";
import { useT } from "@/i18n";
import { useListeningStore } from "@/social/listeningStore";
import { useTheme } from "@/theme/provider";
import { EmptyState } from "@/ui";
import { ListSkeleton, PageHeader, pageType, useGutter, WaitHint } from "@/ui/page";
import { FriendActivityRow } from "./rows";

/** Panel frame (desktop right panel): narrower than the page gutter. */
const PANEL_INSET = 16;
/**
 * How long the page waits for the first roster before calling it empty. The
 * channel answers in well under a second; past this, an account with no
 * listening friends must not stare at a skeleton.
 */
const FIRST_ROSTER_WAIT_MS = 6000;

export default function FriendsBody({ standalone = false }: { standalone?: boolean }) {
  const t = useT();
  const { tokens } = useTheme();
  const gutter = useGutter();
  const friends = useListeningStore((s) => s.friends);
  const ready = useListeningStore((s) => s.ready);
  const topPadding = useContentTopPadding();
  const bottomPadding = useContentBottomPadding();
  const inset = standalone ? gutter : PANEL_INSET;

  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    if (ready) return;
    const timer = setTimeout(() => setGaveUp(true), FIRST_ROSTER_WAIT_MS);
    return () => clearTimeout(timer);
  }, [ready]);
  const waiting = friends.length === 0 && !ready && !gaveUp;

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
      // point 13). As a pushed screen it pays its own inset.
      contentContainerStyle={{
        paddingTop: standalone ? topPadding : 0,
        paddingBottom: standalone ? bottomPadding + 16 : 24,
      }}
      showsVerticalScrollIndicator={false}
    >
      {standalone ? (
        <PageHeader title={t("native.friends.title")} style={{ paddingBottom: 12 }} />
      ) : (
        <View style={{ paddingHorizontal: PANEL_INSET, paddingBottom: 8 }}>
          <Text style={[pageType.section, { color: tokens.foreground }]}>
            {t("native.friends.title")}
          </Text>
        </View>
      )}
      {waiting ? (
        <View>
          <ListSkeleton rows={6} round />
          <WaitHint active />
        </View>
      ) : friends.length === 0 ? (
        <EmptyState icon="users" text={t("components.music.FriendActivityPanel.empty")} />
      ) : (
        friends.map((activity, index) => (
          <FriendActivityRow
            key={activity.user.id}
            activity={activity}
            inset={inset}
            order={index < 12 ? index : undefined}
          />
        ))
      )}
    </ScrollView>
  );
}
