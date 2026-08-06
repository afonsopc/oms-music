/**
 * (player) modal pager host (FR-17 shell): a full-screen pager across
 * Now Playing / Lyrics / Queue. The three (player) routes render this host at
 * different initial pages. Page bodies are feature modules owned by WP7.
 *
 * The pager scrolls VERTICALLY. It used to page sideways, which meant lyrics
 * were two horizontal swipes away and read as a separate screen rather than
 * more of the song; every music app people actually use puts them below the
 * artwork, reached by pushing the now playing view up. Vertical also frees the
 * horizontal axis, which the sheet's own drag-to-dismiss wants.
 */
import React, { useEffect, useRef, useState } from "react";
import { ScrollView, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import NowPlayingBody from "@/features/player";
import QueueBody from "@/features/player/queue";
import LyricsBody from "@/features/lyrics";
import { useTheme } from "@/theme/provider";

/** 0 = Now Playing, 1 = Lyrics, 2 = Queue (top to bottom). */
export type PlayerPageIndex = 0 | 1 | 2;

const INDICATOR_HEIGHT = 24;

const PAGES = [NowPlayingBody, LyricsBody, QueueBody] as const;

export const PlayerPager = ({ initialPage }: { initialPage: PlayerPageIndex }) => {
  const { height } = useWindowDimensions();
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const [activePage, setActivePage] = useState<number>(initialPage);

  // The sheet presentation eats the top inset, so a page is the window height
  // less the bottom inset the indicator column occupies.
  const pageHeight = Math.max(1, height - insets.bottom - INDICATOR_HEIGHT);

  // contentOffset covers iOS; the effect covers platforms that ignore it.
  useEffect(() => {
    if (initialPage > 0) {
      scrollRef.current?.scrollTo({ y: initialPage * pageHeight, animated: false });
    }
    // Initial positioning only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // No close chevron: the sheet's grabber and its drag-down gesture already
  // close it, and the button was one more thing above the artwork.
  return (
    <View style={{ flex: 1, backgroundColor: tokens.background }}>
      <ScrollView
        ref={scrollRef}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        contentOffset={{ x: 0, y: initialPage * pageHeight }}
        onMomentumScrollEnd={(event) => {
          const page = Math.round(event.nativeEvent.contentOffset.y / pageHeight);
          setActivePage(page);
        }}
        style={{ flex: 1 }}
      >
        {PAGES.map((PageBody, index) => (
          <View key={index} style={{ height: pageHeight }}>
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
          height: INDICATOR_HEIGHT,
          alignItems: "center",
          paddingBottom: insets.bottom,
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
