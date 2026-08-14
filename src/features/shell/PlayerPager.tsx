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
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import NowPlayingBody, { useSongAccent } from "@/features/player";
import { AboutArtistCard } from "@/features/player/aboutArtistCard";
import { LyricsCard } from "@/features/lyrics/card";
import { useT } from "@/i18n";
import { usePlaybackView } from "@/remote/mirror";
import { playerGradient } from "@/theme/gradients";
import { useTheme } from "@/theme/provider";
import { gradientBackground, Icon } from "@/ui";
import { ChevronDownGlyph } from "./glyphs";

export const NowPlayingScroll = () => {
  const { height } = useWindowDimensions();
  const { tokens, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const t = useT();

  const song = usePlaybackView((v) => v.song);
  const accent = useSongAccent(song);
  const [accentDark, accentBright] = playerGradient(accent, scheme);

  // The sheet presentation already insets the top; now playing is composed
  // for a full viewport. This composition is MOBILE-ONLY now: the desktop
  // right panel renders its own lean tenant (features/player/
  // panelNowPlaying) and desktop fullscreen is the cinema overlay
  // (features/player/cinema), so no pane ever needs to re-measure this.
  const viewport = Math.max(1, height - insets.bottom);

  const gradientCss = `linear-gradient(to bottom, ${accentBright} 0%, ${accentDark} 55%, ${tokens.background} 90%)`;

  // On native the sheet dismisses with a drag; a browser has no such gesture,
  // so without this chevron the page was a room with no door. A direct load
  // of /now-playing has no history to pop - Home is the door then.
  const close = (): void => {
    if (router.canGoBack()) router.back();
    else router.replace("/(main)/(tabs)/home");
  };
  const webClose =
    Platform.OS === "web" ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("native.common.close")}
        hitSlop={12}
        onPress={close}
        style={{ position: "absolute", top: 10, left: 12, zIndex: 10, padding: 6 }}
      >
        <ChevronDownGlyph color={tokens.foreground} size={26} />
      </Pressable>
    ) : null;

  return (
    <View style={{ flex: 1 }}>
      {webClose}
      <ScrollView
      style={{ flex: 1, backgroundColor: tokens.background }}
      contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
      showsVerticalScrollIndicator={false}
    >
      {/* ONE gradient across the whole content - body, lyrics card, queue,
          artist card - accent up top fading into the page background, so the
          old hard cut at the viewport edge cannot exist. Keyed by its own
          colours: a song change CROSSFADES the new accent over the old one
          instead of snapping. */}
      <Animated.View
        key={gradientCss}
        entering={FadeIn.duration(450)}
        exiting={FadeOut.duration(450)}
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, gradientBackground(gradientCss)]}
      />
      <View style={{ height: viewport }}>
        <NowPlayingBody />
      </View>

      <LyricsCard />

      {/* The queue kept its full-screen route; this compact button is how
          you reach it now that the pager pages are gone. */}
      <Pressable
        onPress={() => router.push("/(player)/queue")}
        accessibilityRole="button"
        style={({ pressed }) => ({
          alignSelf: "center",
          marginTop: 16,
          borderRadius: 999,
          backgroundColor: tokens.secondary,
          paddingHorizontal: 22,
          paddingVertical: 10,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Icon name="list-music" size={16} color={tokens.foreground} />
        <Text style={{ color: tokens.foreground, fontSize: 14, fontWeight: "700" }}>
          {t("components.music.NowPlayingSheet.queue")}
        </Text>
      </Pressable>

      <AboutArtistCard />
      </ScrollView>
    </View>
  );
};

/** Full-screen player subpage (lyrics, queue): body + a way back down. */
export const PlayerSubpage = ({ children }: { children: React.ReactNode }) => {
  const { tokens } = useTheme();
  const router = useRouter();
  const t = useT();
  // Deep-loaded on web (refresh on /lyrics), there is no stack to pop: the
  // now-playing screen is where "back down" lands then.
  const back = (): void => {
    if (router.canGoBack()) router.back();
    else router.replace("/(player)/now-playing");
  };
  return (
    <View style={{ flex: 1, backgroundColor: tokens.background }}>
      <View style={{ alignItems: "flex-start", paddingHorizontal: 12, paddingTop: 10 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("native.common.close")}
          hitSlop={12}
          onPress={back}
          style={{ padding: 6 }}
        >
          <ChevronDownGlyph color={tokens.mutedForeground} size={26} />
        </Pressable>
      </View>
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  );
};
