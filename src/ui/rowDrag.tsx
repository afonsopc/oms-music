/**
 * iOS/Android: the moving half of a drag-to-reorder. The finger writes one
 * shared value and every row derives its offset from it on the UI thread, so
 * a drag costs no React render and no bridge traffic per frame (the old
 * Animated.Value was JS-driven and repainted some 100 mounted rows per move:
 * ticket #49, "trava bastante"). The web pair keeps Animated.
 */
import React, { useMemo } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, type SharedValue } from "react-native-reanimated";
import { rowDragOffset } from "./rowDragMath";

export interface RowDragDriver {
  index: SharedValue<number>;
  dy: SharedValue<number>;
  scrolled: SharedValue<number>;
  begin: (index: number) => void;
  move: (dy: number) => void;
  setScrolled: (scrolled: number) => void;
  end: () => void;
}

export const useRowDragDriver = (): RowDragDriver => {
  const index = useSharedValue(-1);
  const dy = useSharedValue(0);
  const scrolled = useSharedValue(0);
  return useMemo(
    () => ({
      index,
      dy,
      scrolled,
      begin: (at) => {
        dy.set(0);
        scrolled.set(0);
        index.set(at);
      },
      move: (value) => dy.set(value),
      setScrolled: (value) => scrolled.set(value),
      end: () => {
        index.set(-1);
        dy.set(0);
        scrolled.set(0);
      },
    }),
    [index, dy, scrolled],
  );
};

export interface RowDragViewProps {
  driver: RowDragDriver;
  index: number;
  rowHeight: number;
  liftColor: string;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

export const RowDragView = ({ driver, index, rowHeight, liftColor, style, children }: RowDragViewProps) => {
  const { index: dragged, dy, scrolled } = driver;
  const moving = useAnimatedStyle(() => {
    const from = dragged.get();
    if (from < 0) return { transform: [{ translateY: 0 }], zIndex: 0, elevation: 0, backgroundColor: "transparent" };
    const offset = rowDragOffset(index, from, dy.get() + scrolled.get(), rowHeight);
    const lifted = from === index;
    return {
      transform: [{ translateY: offset }],
      zIndex: lifted ? 10 : 0,
      elevation: lifted ? 4 : 0,
      backgroundColor: lifted ? liftColor : "transparent",
    };
  }, [index, rowHeight, liftColor]);
  return <Animated.View style={[{ borderRadius: 8 }, style, moving]}>{children}</Animated.View>;
};
