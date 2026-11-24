/**
 * iOS/Android: drag a row to the left to uncover one action (Remove from
 * playlist, ticket #51). It stays open until the action, a tap on the row or
 * a drag back; nothing is removed by the drag alone. The web has the menu.
 */
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import type { SongMenuItem } from "@/contracts/songMenu";
import { useT } from "@/i18n";
import { haptics } from "@/lib/haptics";
import { useTheme } from "@/theme/provider";
import { Icon } from "./icons";
import { swipeSettles, SWIPE_ACTION_WIDTH } from "./swipeMath";

const SPRING = { damping: 28, stiffness: 320, overshootClamping: true } as const;

export interface SwipeRowProps {
  action: SongMenuItem;
  children: React.ReactNode;
}

export const SwipeRow = ({ action, children }: SwipeRowProps) => {
  const t = useT();
  const { tokens } = useTheme();
  const x = useSharedValue(0);
  const from = useSharedValue(0);
  // The button only exists while it can be seen: no extra view per idle row.
  const [uncovered, setUncovered] = useState(false);
  const [open, setOpen] = useState(false);

  const settled = (next: boolean): void => {
    if (next && !open) haptics.select();
    setOpen(next);
    if (!next) setUncovered(false);
  };
  const close = (): void => {
    x.set(withSpring(0, SPRING));
    settled(false);
  };

  const pan = Gesture.Pan()
    .activeOffsetX(open ? [-14, 14] : [-14, 10_000])
    .failOffsetY([-12, 12])
    .onStart(() => {
      from.value = x.value;
      runOnJS(setUncovered)(true);
    })
    .onUpdate((event) => {
      const next = from.value + event.translationX;
      x.value = next > 0 ? 0 : next < -SWIPE_ACTION_WIDTH * 1.3 ? -SWIPE_ACTION_WIDTH * 1.3 : next;
    })
    .onEnd((event) => {
      const stays = swipeSettles(x.value, event.velocityX);
      x.value = withSpring(stays ? -SWIPE_ACTION_WIDTH : 0, SPRING);
      runOnJS(settled)(stays);
    })
    .onFinalize((_event, success) => {
      if (success || x.value === 0 || x.value === -SWIPE_ACTION_WIDTH) return;
      x.value = withSpring(0, SPRING);
      runOnJS(settled)(false);
    });
  const moving = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return (
    <View>
      {uncovered ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(action.labelKey, action.labelParams)}
          onPress={() => {
            close();
            action.onPress();
          }}
          style={[styles.action, { backgroundColor: tokens.destructive }]}
        >
          <Icon name="trash" size={18} color="#ffffff" />
          <Text numberOfLines={1} style={styles.label}>
            {t("native.playlist.swipeRemove")}
          </Text>
        </Pressable>
      ) : null}
      <GestureDetector gesture={pan}>
        <Animated.View style={[uncovered ? { backgroundColor: tokens.background } : null, moving]}>
          {children}
          {/* While open, a tap on the row closes it instead of playing. */}
          {open ? <Pressable onPress={close} style={StyleSheet.absoluteFill} /> : null}
        </Animated.View>
      </GestureDetector>
    </View>
  );
};

const styles = StyleSheet.create({
  action: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: 0,
    width: SWIPE_ACTION_WIDTH,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    borderRadius: 8,
  },
  label: { color: "#ffffff", fontSize: 12, fontWeight: "600" },
});
