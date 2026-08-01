/**
 * Home friends listening strip (FR-29 content half). Home owns WHERE the
 * strip sits (filter = all, between the top tiles and the mix rail); this is
 * the content, registered into `features/home/friendsSlot` through the
 * WP10 register.ts so Home never imports the friends feature directly.
 *
 * Visibility: the slot reports active only when at least one friend row
 * carries a song, so the section collapses entirely on an account whose
 * friends share nothing (FR-29 AC). Rows with a jam offer a one-tap join.
 */
import React from "react";
import { Pressable, Text, View } from "react-native";
import { avatarUrl } from "@/api/mediaUrl";
import type { HomeFriendsSlot } from "@/features/home/friendsSlot";
import { useT } from "@/i18n";
import { jamJoin } from "@/jam/channel";
import { useJamStore } from "@/jam/store";
import { artistNamesLine } from "@/social/display";
import { hasListeningRows, listeningStore, useListeningStore } from "@/social/listeningStore";
import { useTheme } from "@/theme/provider";
import { RADIUS } from "@/theme/tokens";
import { ArtworkImage, Icon, PlayingBars, Rail, TILE_WIDTH } from "@/ui";
import { isLiveRow, openFriendProfile } from "./rows";

const STRIP = "components.music.FriendsListeningStrip";
/** Matches the Tile geometry so the strip lines up with the other rails. */
const CARD_PADDING = 12;
const ARTWORK_SIZE = TILE_WIDTH - CARD_PADDING * 2;

export const FriendsListeningStrip = () => {
  const t = useT();
  const { tokens } = useTheme();
  const rows = useListeningStore((s) => s.friends);
  const myJamId = useJamStore((s) => s.jam?.id ?? null);
  const withSong = rows.filter((row) => row.song);
  if (withSong.length === 0) return null;

  return (
    <Rail title={t(`${STRIP}.title`)}>
      {withSong.map((activity) => {
        const live = isLiveRow(activity);
        const joinable = activity.jam_id !== null && activity.jam_id !== myJamId;
        return (
          <Pressable
            key={activity.user.id}
            accessibilityRole="button"
            accessibilityLabel={activity.user.name || activity.user.handle}
            onPress={() => openFriendProfile(activity.user.handle)}
            style={({ pressed }) => ({
              width: TILE_WIDTH,
              padding: CARD_PADDING,
              gap: 8,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <View>
              <ArtworkImage
                uri={activity.song?.artwork_url ?? avatarUrl(activity.user.id)}
                size={ARTWORK_SIZE}
              />
              <View style={{ position: "absolute", left: -6, bottom: -6 }}>
                <ArtworkImage uri={avatarUrl(activity.user.id)} size={30} shape="circle" />
              </View>
              {live ? (
                <View style={{ position: "absolute", right: 6, bottom: 6 }}>
                  <PlayingBars />
                </View>
              ) : null}
            </View>
            <View style={{ gap: 1 }}>
              <Text
                numberOfLines={1}
                style={{ color: tokens.foreground, fontSize: 12, fontWeight: "700" }}
              >
                {activity.user.name || activity.user.handle}
              </Text>
              <Text numberOfLines={1} style={{ color: tokens.foreground, fontSize: 12 }}>
                {activity.song?.title}
              </Text>
              <Text numberOfLines={1} style={{ color: tokens.mutedForeground, fontSize: 11 }}>
                {artistNamesLine(activity.song?.artist_names)}
              </Text>
            </View>
            {joinable ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  if (activity.jam_id === null) return;
                  void jamJoin(activity.jam_id);
                }}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 4,
                  paddingVertical: 4,
                  borderRadius: RADIUS,
                  backgroundColor: tokens.secondary,
                  opacity: pressed ? 0.8 : 1,
                })}
              >
                <Icon name="radio" size={12} color={tokens.secondaryForeground} />
                <Text
                  style={{ color: tokens.secondaryForeground, fontSize: 10, fontWeight: "700" }}
                >
                  {t(`${STRIP}.joinJam`)}
                </Text>
              </Pressable>
            ) : null}
          </Pressable>
        );
      })}
    </Rail>
  );
};

/** Slot consumed by Home (registered from features/jam/register.ts). */
export const friendsStripSlot: HomeFriendsSlot = {
  isActive: () => hasListeningRows(listeningStore.getState().friends),
  subscribe: (cb: () => void) => listeningStore.subscribe(cb),
  Component: FriendsListeningStrip,
};
