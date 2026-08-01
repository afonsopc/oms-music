/**
 * The single empty-state look (web RailEmpty parity): centered icon,
 * muted text, optional secondary CTA.
 */
import React from "react";
import { Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon, type IconName } from "./icons";
import { useTheme } from "@/theme/provider";

export interface EmptyStateProps {
  icon?: IconName;
  text: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}

export const EmptyState = ({ icon = "music", text, actionLabel, onAction, style }: EmptyStateProps) => {
  const { tokens } = useTheme();
  return (
    <View style={[{ alignItems: "center", gap: 12, paddingVertical: 40, paddingHorizontal: 24 }, style]}>
      <Icon name={icon} size={28} color={tokens.mutedForeground} />
      <Text
        style={{ color: tokens.mutedForeground, fontSize: 14, textAlign: "center", lineHeight: 20 }}
      >
        {text}
      </Text>
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          style={({ pressed }) => ({
            borderWidth: 1,
            borderColor: tokens.border,
            borderRadius: 999,
            paddingHorizontal: 16,
            paddingVertical: 8,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text style={{ color: tokens.foreground, fontWeight: "600", fontSize: 13 }}>
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
};
