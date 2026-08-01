/**
 * Horizontal rail section (web HomeCarousel parity): bold section header,
 * optional uppercase "show all" link, horizontally scrolling children with
 * a 16pt gap. Callers hide the whole rail when empty (FR: rails collapse).
 */
import React from "react";
import { Pressable, ScrollView, Text, View, type StyleProp, type ViewStyle } from "react-native";
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

export const Rail = ({ title, showAllLabel, onShowAll, children, style }: RailProps) => {
  const { tokens } = useTheme();
  return (
    <View style={[{ gap: 8 }, style]}>
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
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 12, gap: 4 }}
      >
        {children}
      </ScrollView>
    </View>
  );
};
