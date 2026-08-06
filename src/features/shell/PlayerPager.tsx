/**
 * (player) modal host (FR-17 shell): ONE continuous vertical scroll through
 * Now Playing, then Lyrics, then Queue. The three (player) routes render this
 * host scrolled to different offsets. Page bodies are feature modules owned
 * by WP7.
 *
 * Continuous, not paged. The paged version snapped each section to its own
 * screen with an indicator-dot strip overlaid at the bottom, which read as
 * three separate pages (and the dots sat on top of the now playing extras
 * row). The Spotify idiom the owner asked for is a single scroll where the
 * lyrics are simply further down the same surface, so `pagingEnabled` and the
 * dots are gone and the scroll runs free.
 */
import React, { useEffect, useRef } from "react";
import { ScrollView, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import NowPlayingBody from "@/features/player";
import QueueBody from "@/features/player/queue";
import LyricsBody from "@/features/lyrics";
import { useTheme } from "@/theme/provider";

/** 0 = Now Playing, 1 = Lyrics, 2 = Queue (top to bottom). */
export type PlayerPageIndex = 0 | 1 | 2;

const SECTIONS = [NowPlayingBody, LyricsBody, QueueBody] as const;

export const PlayerPager = ({ initialPage }: { initialPage: PlayerPageIndex }) => {
  const { height } = useWindowDimensions();
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);

  // Each section still fills one screen: now playing is composed for a full
  // viewport, and lyrics/queue manage their own internal scrolling.
  const sectionHeight = Math.max(1, height - insets.bottom);

  // contentOffset covers iOS; the effect covers platforms that ignore it.
  useEffect(() => {
    if (initialPage > 0) {
      scrollRef.current?.scrollTo({ y: initialPage * sectionHeight, animated: false });
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
        showsVerticalScrollIndicator={false}
        contentOffset={{ x: 0, y: initialPage * sectionHeight }}
        contentContainerStyle={{ paddingBottom: insets.bottom }}
        style={{ flex: 1 }}
      >
        {SECTIONS.map((SectionBody, index) => (
          <View key={index} style={{ height: sectionHeight }}>
            <SectionBody />
          </View>
        ))}
      </ScrollView>
    </View>
  );
};
