/**
 * Shared button primitives: the 56px primary play FAB and the ghost icon
 * button used by the ActionBar, tiles and sheets.
 */
import React from "react";
import { ActivityIndicator, Pressable, type StyleProp, type ViewStyle } from "react-native";
import { Icon, type IconName } from "./icons";
import { heavyShadow } from "./uiTheme";
import { useTheme } from "@/theme/provider";

export interface PlayFabProps {
  playing?: boolean;
  loading?: boolean;
  onPress: () => void;
  /** Diameter; ActionBar uses 56, tiles 40. */
  size?: number;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
}

/** Round primary play/pause button (monochrome `primary`, FR tokens). */
export const PlayFab = ({
  playing = false,
  loading = false,
  onPress,
  size = 56,
  accessibilityLabel,
  style,
}: PlayFabProps) => {
  const { tokens } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      // NOT disabled while loading (owner report 2026-08-16, points 1-2:
      // "the play button does not respond in that interval"). The spinner
      // says the engine is working on it, not that the control is dead:
      // toggle() runs on INTENT (engine.toggle), so cancelling a load that
      // is taking too long is exactly what a user pressing it then means,
      // and disabling the one control that can cancel left them stuck
      // watching a spinner with no way out.
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={4}
      style={({ pressed }) => [
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: tokens.primary,
          alignItems: "center",
          justifyContent: "center",
          transform: [{ scale: pressed ? 0.96 : 1 }],
        },
        heavyShadow,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={tokens.primaryForeground} />
      ) : (
        <Icon
          name={playing ? "pause" : "play"}
          size={size * 0.42}
          color={tokens.primaryForeground}
          filled
        />
      )}
    </Pressable>
  );
};

export interface GhostIconButtonProps {
  icon: IconName;
  onPress: () => void;
  /** Active state renders in `primary` (offline toggle, liked heart...). */
  active?: boolean;
  filled?: boolean;
  disabled?: boolean;
  size?: number;
  color?: string;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
}

/** Borderless icon button with a 44pt hit target. */
export const GhostIconButton = ({
  icon,
  onPress,
  active = false,
  filled = false,
  disabled = false,
  size = 20,
  color,
  accessibilityLabel,
  style,
}: GhostIconButtonProps) => {
  const { tokens } = useTheme();
  const tint = color ?? (active ? tokens.primary : tokens.foreground);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      style={({ pressed }) => [
        {
          width: 44,
          height: 44,
          alignItems: "center",
          justifyContent: "center",
          opacity: disabled ? 0.4 : pressed ? 0.6 : active ? 1 : 0.85,
        },
        style,
      ]}
    >
      <Icon name={icon} size={size} color={tint} filled={filled || (active && icon === "heart")} />
    </Pressable>
  );
};
