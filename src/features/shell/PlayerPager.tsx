/**
 * (player) modal surfaces (FR-17 shell), in the Spotify shape the owner asked
 * for by screenshot:
 *
 *  - `NowPlayingScroll`: the now-playing route. One free vertical scroll: the
 *    full-viewport now playing screen, then the lyrics CARD (features/lyrics
 *    card.tsx), then a queue row. No paging, no indicator dots - the dots
 *    strip sat on top of the extras row and the snap read as separate pages.
 *  - `PlayerSubpage`: chrome for the full-screen lyrics and queue routes - a
 *    chevron-down back button over the body, like the full-lyrics view in the
 *    reference screenshots.
 */
import React from "react";
import { Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import NowPlayingBody from "@/features/player";
import { LyricsCard } from "@/features/lyrics/card";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import { Icon } from "@/ui";
import { ChevronDownGlyph } from "./glyphs";

export const NowPlayingScroll = () => {
  const { height } = useWindowDimensions();
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const t = useT();

  // The sheet presentation already insets the top; now playing is composed
  // for a full viewport.
  const viewport = Math.max(1, height - insets.bottom);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: tokens.background }}
      contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
      showsVerticalScrollIndicator={false}
    >
      <View style={{ height: viewport }}>
        <NowPlayingBody />
      </View>

      <LyricsCard />

      {/* The queue kept its full-screen route; this row is how you reach it
          now that the pager pages are gone. */}
      <Pressable
        onPress={() => router.push("/(player)/queue")}
        accessibilityRole="button"
        style={({ pressed }) => ({
          marginHorizontal: 16,
          marginTop: 12,
          borderRadius: 14,
          backgroundColor: tokens.secondary,
          paddingHorizontal: 20,
          paddingVertical: 16,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Icon name="list-music" size={18} color={tokens.foreground} />
        <Text style={{ flex: 1, color: tokens.foreground, fontSize: 15, fontWeight: "700" }}>
          {t("components.music.NowPlayingSheet.queue")}
        </Text>
        <Icon name="chevron-right" size={18} color={tokens.mutedForeground} />
      </Pressable>
    </ScrollView>
  );
};

/** Full-screen player subpage (lyrics, queue): body + a way back down. */
export const PlayerSubpage = ({ children }: { children: React.ReactNode }) => {
  const { tokens } = useTheme();
  const router = useRouter();
  const t = useT();
  return (
    <View style={{ flex: 1, backgroundColor: tokens.background }}>
      <View style={{ alignItems: "flex-start", paddingHorizontal: 12, paddingTop: 10 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("native.common.close")}
          hitSlop={12}
          onPress={() => router.back()}
          style={{ padding: 6 }}
        >
          <ChevronDownGlyph color={tokens.mutedForeground} size={26} />
        </Pressable>
      </View>
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  );
};
