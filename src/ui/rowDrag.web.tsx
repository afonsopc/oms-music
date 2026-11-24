/** Web pair of rowDrag.tsx: a single Animated.Value and one interpolation per row. */
import React, { useMemo, useState, useSyncExternalStore } from "react";
import { Animated } from "react-native";
import { rowDragOffset } from "./rowDragMath";
import type { RowDragViewProps as NativeProps } from "./rowDrag";

const SLIDE_PX = 10;

export interface RowDragDriver {
  value: Animated.Value;
  subscribe: (cb: () => void) => () => void;
  getIndex: () => number;
  begin: (index: number) => void;
  move: (dy: number) => void;
  setScrolled: (scrolled: number) => void;
  end: () => void;
}

const createDriver = (): RowDragDriver => {
  const value = new Animated.Value(0);
  const listeners = new Set<() => void>();
  let index = -1;
  let dy = 0;
  let scrolled = 0;
  const apply = (): void => value.setValue(dy + scrolled);
  const setIndex = (next: number): void => {
    index = next;
    for (const cb of listeners) cb();
  };
  return {
    value,
    subscribe: (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    getIndex: () => index,
    begin: (at) => {
      dy = 0;
      scrolled = 0;
      apply();
      setIndex(at);
    },
    move: (next) => {
      dy = next;
      apply();
    },
    setScrolled: (next) => {
      scrolled = next;
      apply();
    },
    end: () => {
      dy = 0;
      scrolled = 0;
      setIndex(-1);
      apply();
    },
  };
};

export const useRowDragDriver = (): RowDragDriver => {
  const [driver] = useState(createDriver);
  return driver;
};

type RowDragViewProps = Omit<NativeProps, "driver"> & { driver: RowDragDriver };

export const RowDragView = ({ driver, index, rowHeight, liftColor, style, children }: RowDragViewProps) => {
  const from = useSyncExternalStore(driver.subscribe, driver.getIndex, driver.getIndex);
  const moving = useMemo(() => {
    if (from < 0) return null;
    if (from === index) {
      return {
        transform: [{ translateY: driver.value }],
        zIndex: 10,
        elevation: 4,
        backgroundColor: liftColor,
        borderRadius: 8,
      };
    }
    const below = index > from;
    const step = (index - from + (below ? -0.5 : 0.5)) * rowHeight;
    return {
      transform: [
        {
          translateY: driver.value.interpolate({
            inputRange: [step - SLIDE_PX, step + SLIDE_PX],
            outputRange: [
              rowDragOffset(index, from, step - SLIDE_PX, rowHeight),
              rowDragOffset(index, from, step + SLIDE_PX, rowHeight),
            ],
            extrapolate: "clamp" as const,
          }),
        },
      ],
    };
  }, [from, index, rowHeight, liftColor, driver]);
  return <Animated.View style={[style, moving]}>{children}</Animated.View>;
};
