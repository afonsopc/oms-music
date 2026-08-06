/**
 * (player) modal pager host (FR-17 shell): a full-screen swipeable pager
 * across Now Playing / Queue / Lyrics / Friends. The three (player) routes
 * render this host with different initial pages (the Friends page is pager
 * content only, matching the web's rail tabs). Page bodies are feature
 * modules owned by WP7 (player, lyrics) and WP10 (friends).
 */
import React, { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, View, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import NowPlayingBody from "@/features/player";
import QueueBody from "@/features/player/queue";
import LyricsBody from "@/features/lyrics";
import { useTheme } from "@/theme/provider";
import { useT } from "@/i18n";
import { ChevronDownGlyph } from "./glyphs";

/** 0 = Now Playing, 1 = Queue, 2 = Lyrics. */
export type PlayerPageIndex = 0 | 1 | 2;

const PAGES = [NowPlayingBody, QueueBody, LyricsBody] as const;

export const PlayerPager = ({ initialPage }: { initialPage: PlayerPageIndex }) => {
  const { width } = useWindowDimensions();
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const t = useT();
  const scrollRef = useRef<ScrollView>(null);
  const [activePage, setActivePage] = useState<number>(initialPage);

  // contentOffset covers iOS; the effect covers platforms that ignore it.
  useEffect(() => {
    if (initialPage > 0) {
      scrollRef.current?.scrollTo({ x: initialPage * width, animated: false });
    }
    // Initial positioning only; width is stable (portrait-locked app).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: tokens.background, paddingTop: insets.top }}>
      <View style={{ alignItems: "center", paddingVertical: 8 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("native.shell.closePlayer")}
          hitSlop={12}
          onPress={() => router.back()}
          style={{ padding: 8 }}
        >
          <ChevronDownGlyph color={tokens.mutedForeground} size={26} />
        </Pressable>
      </View>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        contentOffset={{ x: initialPage * width, y: 0 }}
        onMomentumScrollEnd={(event) => {
          const page = Math.round(event.nativeEvent.contentOffset.x / Math.max(1, width));
          setActivePage(page);
        }}
        style={{ flex: 1 }}
      >
        {PAGES.map((PageBody, index) => (
          <View key={index} style={{ width, flex: 1 }}>
            <PageBody />
          </View>
        ))}
      </ScrollView>
      <View
        pointerEvents="none"
        style={{
          flexDirection: "row",
          justifyContent: "center",
          gap: 6,
          paddingTop: 8,
          paddingBottom: insets.bottom + 8,
        }}
      >
        {PAGES.map((_, index) => (
          <View
            key={index}
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: index === activePage ? tokens.primary : tokens.muted,
            }}
          />
        ))}
      </View>
    </View>
  );
};
