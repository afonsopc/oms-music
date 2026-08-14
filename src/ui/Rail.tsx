/**
 * Horizontal rail section (web HomeCarousel parity): bold section header,
 * optional uppercase "show all" link, horizontally scrolling children with
 * a 16pt gap. Callers hide the whole rail when empty (FR: rails collapse).
 *
 * Desktop shell additions (plan 4.3, Home row): the audit's exact words are
 * that content past the fold is UNREACHABLE on a desktop without a
 * trackpad - the ScrollView hides its indicator and the mouse wheel does
 * nothing. So above 900px the rail (a) converts vertical wheel motion into
 * horizontal scroll on the real DOM node (react-native-web does not forward
 * onWheel, hence the addEventListener), and (b) shows edge chevrons on
 * hover, each paging by most of a viewport. Below 900px and on native
 * neither exists - the shipped rail, byte for byte.
 */
import React, { useEffect, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { viewHoverProps } from "./a11y";
import { GhostIconButton } from "./buttons";
import { useDesktopShell } from "./shellLayout";
import { heavyShadow } from "./uiTheme";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import { typeScale } from "@/theme/typography";

export interface RailProps {
  title: string;
  /** Localized "Show all" label; the link renders only when both given. */
  showAllLabel?: string;
  onShowAll?: () => void;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** Chevron shows only when there is at least this much left to scroll. */
const EDGE_SLACK = 4;

export const Rail = ({ title, showAllLabel, onShowAll, children, style }: RailProps) => {
  const { tokens } = useTheme();
  const t = useT();
  const desktopShell = useDesktopShell();
  const scrollRef = useRef<ScrollView>(null);
  const [hovered, setHovered] = useState(false);
  const [scrollX, setScrollX] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);

  useEffect(() => {
    if (!desktopShell || Platform.OS !== "web") return;
    // getScrollableNode hands back the real DOM element on web; the wheel
    // listener must be non-passive because redirecting the gesture into
    // horizontal scroll only works if the page's own vertical scroll is
    // preventDefault'd. Trackpads already produce deltaX and are left alone.
    const node = scrollRef.current?.getScrollableNode() as
      | { addEventListener: HTMLElement["addEventListener"]; removeEventListener: HTMLElement["removeEventListener"]; scrollLeft: number }
      | null
      | undefined;
    if (!node) return;
    const onWheel = (event: WheelEvent): void => {
      if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      node.scrollLeft += event.deltaY;
      event.preventDefault();
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [desktopShell]);

  const maxScroll = Math.max(0, contentWidth - viewportWidth);
  const canScrollBack = desktopShell && scrollX > EDGE_SLACK;
  const canScrollForward = desktopShell && maxScroll > 0 && scrollX < maxScroll - EDGE_SLACK;

  const page = (direction: -1 | 1): void => {
    const target = Math.max(
      0,
      Math.min(scrollX + direction * viewportWidth * 0.9, maxScroll),
    );
    scrollRef.current?.scrollTo({ x: target, animated: true });
  };

  const chevron = (direction: -1 | 1): React.ReactNode => (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        justifyContent: "center",
        ...(direction === -1 ? { left: 8 } : { right: 8 }),
      }}
    >
      <GhostIconButton
        icon={direction === -1 ? "chevron-left" : "chevron-right"}
        size={18}
        accessibilityLabel={t(direction === -1 ? "native.desktop.back" : "native.desktop.forward")}
        onPress={() => page(direction)}
        style={[
          {
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: tokens.secondary,
          },
          heavyShadow,
        ]}
      />
    </View>
  );

  return (
    <View style={[{ gap: 8 }, style]} {...viewHoverProps(() => setHovered(true), () => setHovered(false))}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "baseline",
          justifyContent: "space-between",
          paddingHorizontal: 24,
        }}
      >
        <Text style={[typeScale.sectionHeader, { color: tokens.foreground, flex: 1 }]}>
          {title}
        </Text>
        {onShowAll && showAllLabel ? (
          <Pressable onPress={onShowAll} accessibilityRole="link" hitSlop={8}>
            <Text
              style={{
                color: tokens.mutedForeground,
                fontSize: 12,
                fontWeight: "600",
                textTransform: "uppercase",
                letterSpacing: 0.6,
              }}
            >
              {showAllLabel}
            </Text>
          </Pressable>
        ) : null}
      </View>
      <View>
        <ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 12, gap: 4 }}
          onScroll={
            desktopShell
              ? (event) => setScrollX(event.nativeEvent.contentOffset.x)
              : undefined
          }
          scrollEventThrottle={desktopShell ? 32 : undefined}
          onContentSizeChange={desktopShell ? (w) => setContentWidth(w) : undefined}
          onLayout={
            desktopShell
              ? (event) => setViewportWidth(event.nativeEvent.layout.width)
              : undefined
          }
        >
          {children}
        </ScrollView>
        {/* Chevrons are a POINTER affordance and only exist under it: the
            keyboard already reaches everything - tabbing into an off-fold
            tile makes the browser scroll it into view on its own. */}
        {hovered && canScrollBack ? chevron(-1) : null}
        {hovered && canScrollForward ? chevron(1) : null}
      </View>
    </View>
  );
};
