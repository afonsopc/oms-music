/**
 * Standard error state: destructive-tinted line with an optional retry.
 * Defaults to the shared native.common copy.
 */
import React from "react";
import { Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon } from "./icons";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";

export interface ErrorStateProps {
  text?: string;
  onRetry?: () => void;
  retryLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export const ErrorState = ({ text, onRetry, retryLabel, style }: ErrorStateProps) => {
  const { tokens, ink } = useTheme();
  const t = useT();
  return (
    <View style={[{ alignItems: "center", gap: 12, paddingVertical: 40, paddingHorizontal: 24 }, style]}>
      <Icon name="alert-circle" size={28} color={ink.destructive} />
      <Text
        style={{ color: ink.destructive, fontSize: 14, textAlign: "center", lineHeight: 20 }}
      >
        {text ?? t("native.common.unknownError")}
      </Text>
      {onRetry ? (
        <Pressable
          onPress={onRetry}
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
            {retryLabel ?? t("native.common.retry")}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
};
