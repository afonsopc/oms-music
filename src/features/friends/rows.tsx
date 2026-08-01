/**
 * Friend activity row (FR-119), shared by the Friends pager page and the
 * music profile's "listening now" block.
 *
 * Two rules the payload forces:
 * - a sharing-off friend still has a row: presence (online, paused, jam) is
 *   visible, the SONG is null. That is "nothing right now", never a hidden
 *   row;
 * - `song.artist_names` is a comma-joined string on the wire, so it goes
 *   through social/display.ts rather than the domain artist formatter (which
 *   works on `artists` join rows nobody sends for foreign songs).
 */
import React from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { avatarUrl } from "@/api/mediaUrl";
import type { FriendListening } from "@/domain/social";
import { useT } from "@/i18n";
import { jamJoin } from "@/jam/channel";
import { useJamStore } from "@/jam/store";
import { artistNamesLine } from "@/social/display";
import { useTheme } from "@/theme/provider";
import { EMERALD_BADGE, RADIUS } from "@/theme/tokens";
import { ArtworkImage, Icon, PlayingBars } from "@/ui";

const PANEL = "components.music.FriendActivityPanel";

/** Coarse on purpose: the feed is about "now vs earlier", not timestamps. */
export const timeAgo = (
  iso: string | null,
  t: (key: string, params?: Record<string, string | number>) => string,
): string | null => {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;
  const minutes = Math.floor((Date.now() - parsed) / 60_000);
  if (minutes < 2) return t(`${PANEL}.justNow`);
  if (minutes < 60) return t(`${PANEL}.minutesAgo`, { minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t(`${PANEL}.hoursAgo`, { hours });
  return t(`${PANEL}.daysAgo`, { days: Math.floor(hours / 24) });
};

export const isLiveRow = (row: FriendListening): boolean =>
  row.online && !row.paused && !!row.song;

export const openFriendProfile = (handle: string): void => {
  router.push(`/(main)/profile/${encodeURIComponent(handle)}`);
};

export const FriendActivityRow = ({ activity }: { activity: FriendListening }) => {
  const t = useT();
  const { tokens } = useTheme();
  const myJamId = useJamStore((s) => s.jam?.id ?? null);
  const live = isLiveRow(activity);
  const inMyJam = myJamId !== null && activity.jam_id === myJamId;
  const joinable = activity.jam_id !== null && !inMyJam;
  const ago = live ? null : timeAgo(activity.updated_at, t);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={activity.user.name || activity.user.handle}
      onPress={() => openFriendProfile(activity.user.handle)}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 10,
        paddingHorizontal: 16,
        paddingVertical: 10,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View>
        <ArtworkImage uri={avatarUrl(activity.user.id)} size={36} shape="circle" />
        {activity.online ? (
          <View
            style={{
              position: "absolute",
              right: -1,
              bottom: -1,
              width: 10,
              height: 10,
              borderRadius: 5,
              borderWidth: 2,
              borderColor: tokens.background,
              backgroundColor: live ? EMERALD_BADGE : tokens.mutedForeground,
            }}
          />
        ) : null}
      </View>

      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text
            numberOfLines={1}
            style={{ color: tokens.foreground, fontSize: 14, fontWeight: "600", flexShrink: 1 }}
          >
            {activity.user.name || activity.user.handle}
          </Text>
          {live ? <PlayingBars count={3} /> : null}
        </View>

        {activity.song ? (
          <>
            <Text numberOfLines={1} style={{ color: tokens.foreground, fontSize: 12 }}>
              {activity.song.title}
            </Text>
            <Text numberOfLines={1} style={{ color: tokens.mutedForeground, fontSize: 12 }}>
              {artistNamesLine(activity.song.artist_names)}
            </Text>
          </>
        ) : (
          <Text numberOfLines={1} style={{ color: tokens.mutedForeground, fontSize: 12 }}>
            {t(`${PANEL}.nothingShared`)}
          </Text>
        )}

        {ago ? (
          <Text style={{ color: tokens.mutedForeground, fontSize: 10 }}>{ago}</Text>
        ) : null}

        {activity.jam_id !== null ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                paddingHorizontal: 8,
                paddingVertical: 2,
                borderRadius: 999,
                backgroundColor: tokens.secondary,
              }}
            >
              <Icon name="radio" size={11} color={tokens.secondaryForeground} />
              <Text style={{ color: tokens.secondaryForeground, fontSize: 10, fontWeight: "700" }}>
                {t(inMyJam ? `${PANEL}.inYourJam` : `${PANEL}.inAJam`)}
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
                  paddingHorizontal: 10,
                  paddingVertical: 3,
                  borderRadius: RADIUS,
                  backgroundColor: tokens.primary,
                  opacity: pressed ? 0.8 : 1,
                })}
              >
                <Text
                  style={{ color: tokens.primaryForeground, fontSize: 10, fontWeight: "700" }}
                >
                  {t(`${PANEL}.join`)}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>

      {activity.song?.artwork_url ? (
        <ArtworkImage uri={activity.song.artwork_url} size={40} />
      ) : null}
    </Pressable>
  );
};
