/**
 * The 4-bar level meter next to the currently playing track (FR-67).
 * Bars scale vertically on independent, deliberately non-harmonic cycles
 * (equal or harmonic durations resync after a couple of cycles and the
 * meter starts pulsing in unison). Frozen at 1/3 height when paused.
 */
import React, { useEffect, useState } from "react";
import { Animated, Easing, View, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "@/theme/provider";

// Durations from the web PlayingBars; the web used negative animation
// delays to start mid-cycle, approximated here with start offsets.
const BARS = [
  { duration: 900, offset: 0 },
  { duration: 1300, offset: 400 },
  { duration: 1100, offset: 700 },
  { duration: 1500, offset: 200 },
] as const;

const MIN_SCALE = 1 / 3;
const HEIGHT = 14;
const BAR_WIDTH = 2;

export interface PlayingBarsProps {
  /** How many bars to draw (max 4). */
  count?: number;
  /** Bars freeze at 1/3 height when playback is paused. */
  animate?: boolean;
  color?: string;
  style?: StyleProp<ViewStyle>;
}

export const PlayingBars = ({ count = 4, animate = true, color, style }: PlayingBarsProps) => {
  const { tokens } = useTheme();
  const barColor = color ?? tokens.primary;
  const [values] = useState<Animated.Value[]>(() =>
    BARS.map(() => new Animated.Value(MIN_SCALE)),
  );

  useEffect(() => {
    if (!animate) {
      for (const v of values) {
        v.stopAnimation();
        v.setValue(MIN_SCALE);
      }
      return;
    }
    const timers: ReturnType<typeof setTimeout>[] = [];
    const loops: Animated.CompositeAnimation[] = [];
    BARS.forEach((bar, i) => {
      const value = values[i];
      if (!value) return;
      const timer = setTimeout(() => {
        const loop = Animated.loop(
          Animated.sequence([
            Animated.timing(value, {
              toValue: 1,
              duration: bar.duration / 2,
              easing: Easing.inOut(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(value, {
              toValue: MIN_SCALE,
              duration: bar.duration / 2,
              easing: Easing.inOut(Easing.quad),
              useNativeDriver: true,
            }),
          ]),
        );
        loops.push(loop);
        loop.start();
      }, bar.offset);
      timers.push(timer);
    });
    return () => {
      for (const t of timers) clearTimeout(t);
      for (const l of loops) l.stop();
      for (const v of values) {
        v.stopAnimation();
        v.setValue(MIN_SCALE);
      }
    };
  }, [animate, values]);

  return (
    <View
      accessible={false}
      style={[
        {
          flexDirection: "row",
          alignItems: "flex-end",
          height: HEIGHT,
          gap: 2,
        },
        style,
      ]}
    >
      {BARS.slice(0, Math.min(count, BARS.length)).map((_, i) => {
        const value = values[i];
        if (!value) return null;
        return (
          <Animated.View
            key={i}
            style={{
              width: BAR_WIDTH,
              height: HEIGHT,
              borderRadius: 1,
              backgroundColor: barColor,
              transform: [
                // Anchor the scale at the bottom edge: compensate the
                // center-origin scale with a translate.
                {
                  translateY: value.interpolate({
                    inputRange: [0, 1],
                    outputRange: [HEIGHT / 2, 0],
                  }),
                },
                { scaleY: value },
              ],
            }}
          />
        );
      })}
    </View>
  );
};
