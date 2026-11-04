/**
 * Filtros e secções de um ecrã (Tudo · Playlists · Álbuns · Artistas).
 * Desde o redesenho de 2026-11-04 não são pílulas: são palavras, a activa a
 * branco com um traço por baixo que desliza até à escolhida, as outras a
 * cinzento (a SectionNav do omelhorsite.pt). O nome e a API ficaram para os
 * ecrãs não mudarem. Rolam na horizontal quando não cabem.
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
import { haptics } from "@/lib/haptics";
import { useTheme } from "@/theme/provider";
import { useReducedMotion } from "./motion";

export interface FilterPill {
  key: string;
  label: string;
}

export interface FilterPillsProps {
  pills: FilterPill[];
  activeKey: string;
  onChange: (key: string) => void;
  scrollable?: boolean;
  /**
   * Leading/trailing inset of the scrollable strip. Defaults to the screen
   * gutter (20); narrow hosts (the desktop sidebar) pass their own so the
   * words line up with the content around them instead of the screen edge.
   */
  contentPaddingHorizontal?: number;
  style?: StyleProp<ViewStyle>;
}

const TAB_HEIGHT = 40;

export const FilterPills = ({
  pills,
  activeKey,
  onChange,
  scrollable = true,
  contentPaddingHorizontal = 20,
  style,
}: FilterPillsProps) => {
  const { tokens } = useTheme();
  const reduce = useReducedMotion();
  const [layouts, setLayouts] = useState<Record<string, LayoutRectangle>>({});
  const [barX] = useState(() => new Animated.Value(0));
  const [barW] = useState(() => new Animated.Value(0));
  const initialized = useRef(false);
  // Acende no toque, antes de o ecrã acabar de trocar.
  // Vale só enquanto o ecrã ainda não mudou o activeKey.
  const [pending, setPending] = useState<{ key: string; from: string } | null>(null);
  const shownKey = pending && pending.from === activeKey ? pending.key : activeKey;

  const active = layouts[shownKey];

  useEffect(() => {
    if (!active) return;
    if (!initialized.current || reduce) {
      barX.setValue(active.x);
      barW.setValue(active.width);
      initialized.current = true;
      return;
    }
    Animated.parallel([
      Animated.spring(barX, { toValue: active.x, useNativeDriver: false, speed: 24, bounciness: 4 }),
      Animated.spring(barW, { toValue: active.width, useNativeDriver: false, speed: 24, bounciness: 4 }),
    ]).start();
  }, [active, barX, barW, reduce]);

  const row = (
    <View style={{ flexDirection: "row", gap: 22, height: TAB_HEIGHT }}>
      {active ? (
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: 0,
            bottom: 4,
            height: 2,
            borderRadius: 1,
            backgroundColor: tokens.foreground,
            transform: [{ translateX: barX }],
            width: barW,
          }}
        />
      ) : null}
      {pills.map((pill) => {
        const isActive = pill.key === shownKey;
        return (
          <Pressable
            key={pill.key}
            onPress={() => {
              if (pill.key === activeKey) return;
              haptics.select();
              setPending({ key: pill.key, from: activeKey });
              onChange(pill.key);
            }}
            onLayout={(e) => {
              const layout = e.nativeEvent.layout;
              setLayouts((prev) => {
                const prevLayout = prev[pill.key];
                if (prevLayout && prevLayout.x === layout.x && prevLayout.width === layout.width) {
                  return prev;
                }
                return { ...prev, [pill.key]: layout };
              });
            }}
            hitSlop={{ top: 4, bottom: 4, left: 10, right: 10 }}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            style={{ height: TAB_HEIGHT, justifyContent: "center" }}
          >
            {({ pressed }) => (
              <Text
                style={{
                  color: isActive ? tokens.foreground : tokens.mutedForeground,
                  fontSize: 16,
                  fontWeight: isActive ? "700" : "500",
                  opacity: pressed ? 0.6 : 1,
                }}
              >
                {pill.label}
              </Text>
            )}
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
      contentContainerStyle={{ paddingHorizontal: contentPaddingHorizontal }}
      style={style}
    >
      {row}
    </ScrollView>
  );
};
