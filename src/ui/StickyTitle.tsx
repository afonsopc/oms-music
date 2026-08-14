/**
 * Sticky title bar (FR-124): overlays the top of a collection screen and
 * fades in once the hero scrolls off. The surface derives `visible` from
 * its scroll offset (SongTable exposes `onScrollOffset`) and passes the
 * leading play action. Note: no blur library is installed, so the web's
 * backdrop-blur is approximated with a high-opacity background veil.
 */
import React, { useEffect, useState } from "react";
import { Animated, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/theme/provider";
import { backgroundVeil, softShadow } from "./uiTheme";

export interface StickyTitleProps {
  visible: boolean;
  title: string;
  /** Leading action, e.g. a small PlayFab (FR-124 AC). */
  leading?: React.ReactNode;
  /** Extra top offset when not under a safe-area edge. */
  topOffset?: number;
  /**
   * Fixed bar height (desktop shell): the collection screen pins its sticky
   * column header exactly below this bar, so the height must be a known
   * number there rather than whatever the paddings add up to.
   */
  barHeight?: number;
}

export const StickyTitle = ({
  visible,
  title,
  leading,
  topOffset = 0,
  barHeight,
}: StickyTitleProps) => {
  const { tokens, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const [opacity] = useState(() => new Animated.Value(visible ? 1 : 0));

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: 160,
      useNativeDriver: true,
    }).start();
  }, [visible, opacity]);

  return (
    <Animated.View
      pointerEvents={visible ? "auto" : "none"}
      style={[
        {
          position: "absolute",
          top: topOffset,
          left: 0,
          right: 0,
          zIndex: 30,
          opacity,
          backgroundColor: backgroundVeil(scheme, 0.92),
          paddingTop: insets.top,
        },
        softShadow,
      ]}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingHorizontal: 24,
          ...(barHeight != null ? { height: barHeight } : { paddingVertical: 10 }),
        }}
      >
        {leading}
        <Text
          style={{ color: tokens.foreground, fontSize: 18, fontWeight: "700", flex: 1 }}
          numberOfLines={1}
        >
          {title}
        </Text>
      </View>
    </Animated.View>
  );
};
