/**
 * Filter pill row (web HomeFilterPills/sidebar pills parity): rounded-full
 * buttons; the active one carries an animated sliding `primary` capsule
 * behind primary-foreground text. Pills scroll horizontally when they
 * overflow (search pills on narrow screens).
 */
import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Pressable,
  ScrollView,
  Text,
  View,
  type LayoutRectangle,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useTheme } from "@/theme/provider";

export interface FilterPill {
  key: string;
  label: string;
}

export interface FilterPillsProps {
  pills: FilterPill[];
  activeKey: string;
  onChange: (key: string) => void;
  scrollable?: boolean;
  style?: StyleProp<ViewStyle>;
}

const PILL_HEIGHT = 34;

export const FilterPills = ({
  pills,
  activeKey,
  onChange,
  scrollable = true,
  style,
}: FilterPillsProps) => {
  const { tokens } = useTheme();
  const [layouts, setLayouts] = useState<Record<string, LayoutRectangle>>({});
  const [capsuleX] = useState(() => new Animated.Value(0));
  const [capsuleW] = useState(() => new Animated.Value(0));
  const initialized = useRef(false);

  const active = layouts[activeKey];

  useEffect(() => {
    if (!active) return;
    if (!initialized.current) {
      capsuleX.setValue(active.x);
      capsuleW.setValue(active.width);
      initialized.current = true;
      return;
    }
    Animated.parallel([
      Animated.spring(capsuleX, {
        toValue: active.x,
        useNativeDriver: false,
        speed: 20,
        bounciness: 6,
      }),
      Animated.spring(capsuleW, {
        toValue: active.width,
        useNativeDriver: false,
        speed: 20,
        bounciness: 6,
      }),
    ]).start();
  }, [active, capsuleX, capsuleW]);

  const row = (
    <View style={{ flexDirection: "row", gap: 8 }}>
      {active ? (
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            height: PILL_HEIGHT,
            borderRadius: PILL_HEIGHT / 2,
            backgroundColor: tokens.primary,
            transform: [{ translateX: capsuleX }],
            width: capsuleW,
          }}
        />
      ) : null}
      {pills.map((pill) => {
        const isActive = pill.key === activeKey;
        return (
          <Pressable
            key={pill.key}
            onPress={() => onChange(pill.key)}
            onLayout={(e) => {
              const layout = e.nativeEvent.layout;
              setLayouts((prev) => {
                const prevLayout = prev[pill.key];
                if (
                  prevLayout &&
                  prevLayout.x === layout.x &&
                  prevLayout.width === layout.width
                ) {
                  return prev;
                }
                return { ...prev, [pill.key]: layout };
              });
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
            style={{
              height: PILL_HEIGHT,
              paddingHorizontal: 16,
              borderRadius: PILL_HEIGHT / 2,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: isActive ? "transparent" : tokens.secondary,
            }}
          >
            <Text
              style={{
                color: isActive ? tokens.primaryForeground : tokens.foreground,
                fontSize: 13,
                fontWeight: "600",
              }}
            >
              {pill.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  if (!scrollable) return <View style={style}>{row}</View>;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 24 }}
      style={style}
    >
      {row}
    </ScrollView>
  );
};
