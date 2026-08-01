/**
 * Deterministic initials avatar (FR-21 exception): legal ONLY for
 * pictureless artists in card grids. Same name always renders the same
 * hue disc, so pictureless artists stay distinguishable.
 */
import React from "react";
import { Text, View, type StyleProp, type ViewStyle } from "react-native";

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

export const InitialsAvatar = ({ name, size, style }: InitialsAvatarProps) => (
  <View
    accessible={false}
    style={[
      {
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: `hsl(${hueOf(name)}, 45%, 42%)`,
      },
      style,
    ]}
  >
    <Text
      style={{
        color: "#ffffff",
        fontWeight: "600",
        fontSize: Math.max(12, Math.round(size * 0.32)),
      }}
      numberOfLines={1}
    >
      {initialsOf(name) || "?"}
    </Text>
  </View>
);
