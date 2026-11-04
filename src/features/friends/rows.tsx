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
import { profileRoute } from "@/lib/routes";
import { artistNamesLine } from "@/social/display";
import { haptics } from "@/lib/haptics";
import { useTheme } from "@/theme/provider";
import { ArtworkImage, PlayingBars } from "@/ui";
import { Reveal } from "@/ui/motion";
import { pageType } from "@/ui/page";

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
  router.push(profileRoute(handle));
};

/**
 * One friend: round avatar, name, a single grey line with the song (or
 * "Nada de momento") and how long ago, the song cover on the right. Live
 * rows get the playing bars and a white presence dot; online-but-idle a
 * grey one. No colour, no pill: a jam is a word in the meta and "Entrar"
 * is plain text.
 */
export const FriendActivityRow = React.memo(function FriendActivityRow({
  activity,
  inset = 20,
  order,
}: {
  activity: FriendListening;
  /** Side padding: the page gutter, or the right panel's narrow frame. */
  inset?: number;
  /** Ordem na cascata de entrada (omitir: sem animação). */
  order?: number;
}) {
  const t = useT();
  const { tokens } = useTheme();
  const myJamId = useJamStore((s) => s.jam?.id ?? null);
  const live = isLiveRow(activity);
  const inMyJam = myJamId !== null && activity.jam_id === myJamId;
  const joinable = activity.jam_id !== null && !inMyJam;
  const ago = live ? null : timeAgo(activity.updated_at, t);
  const name = activity.user.name || activity.user.handle;

  const songLine = activity.song
    ? [activity.song.title, artistNamesLine(activity.song.artist_names)].filter(Boolean).join(" · ")
    : t(`${PANEL}.nothingShared`);
  const metaLine = [
    activity.jam_id !== null ? t(inMyJam ? `${PANEL}.inYourJam` : `${PANEL}.inAJam`) : null,
    songLine,
    ago,
  ]
    .filter(Boolean)
    .join(" · ");

  const row = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name}
      onPress={() => openFriendProfile(activity.user.handle)}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        minHeight: 64,
        paddingVertical: 8,
        paddingHorizontal: inset,
        backgroundColor: pressed ? tokens.secondary : hovered ? tokens.accent : "transparent",
      })}
    >
      <View>
        <ArtworkImage uri={avatarUrl(activity.user.id)} size={48} shape="circle" />
        {activity.online ? (
          <View
            style={{
              position: "absolute",
              right: 0,
              bottom: 0,
              width: 12,
              height: 12,
              borderRadius: 6,
              borderWidth: 2,
              borderColor: tokens.background,
              backgroundColor: live ? tokens.foreground : tokens.mutedForeground,
            }}
          />
        ) : null}
      </View>

      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text
            numberOfLines={1}
            style={[pageType.body, { color: tokens.foreground, fontWeight: "500", flexShrink: 1 }]}
          >
            {name}
          </Text>
          {live ? <PlayingBars count={3} /> : null}
        </View>
        <Text numberOfLines={2} style={[pageType.meta, { color: tokens.mutedForeground }]}>
          {metaLine}
        </Text>
      </View>

      {joinable ? (
        <Pressable
          accessibilityRole="button"
          hitSlop={10}
          onPress={() => {
            if (activity.jam_id === null) return;
            haptics.tap();
            void jamJoin(activity.jam_id);
          }}
        >
          {({ pressed }) => (
            <Text
              style={[pageType.label, { color: tokens.foreground, fontSize: 14, opacity: pressed ? 0.6 : 1 }]}
            >
              {t(`${PANEL}.join`)}
            </Text>
          )}
        </Pressable>
      ) : null}

      {activity.song?.artwork_url ? (
        <ArtworkImage uri={activity.song.artwork_url} size={48} />
      ) : null}
    </Pressable>
  );
  return order == null ? row : <Reveal order={order}>{row}</Reveal>;
});
