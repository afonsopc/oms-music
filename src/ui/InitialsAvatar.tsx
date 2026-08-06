/**
 * Deterministic initials avatar (FR-21 exception): legal ONLY for
 * pictureless artists in card grids. Same name always renders the same
 * hue disc, so pictureless artists stay distinguishable.
 */
import React from "react";
import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import { onColor } from "@/theme/contrast";

const initialsOf = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");

const hueOf = (name: string): number => {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return ((hash % 360) + 360) % 360;
};

export interface InitialsAvatarProps {
  name: string;
  size: number;
  style?: StyleProp<ViewStyle>;
}

export const InitialsAvatar = ({ name, size, style }: InitialsAvatarProps) => {
  // The hue disc is deterministic per name, so its on-color is too: yellows
  // and greens at 45%/42% still land dark enough for white, but the check is
  // cheap and it is the same rule every other identity surface follows.
  const disc = `hsl(${hueOf(name)}, 45%, 42%)`;
  return (
    <View
      accessible={false}
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: disc,
        },
        style,
      ]}
    >
      <Text
        style={{
          color: onColor(disc),
          fontWeight: "600",
          fontSize: Math.max(12, Math.round(size * 0.32)),
        }}
        numberOfLines={1}
      >
        {initialsOf(name) || "?"}
      </Text>
    </View>
  );
};
