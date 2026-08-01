/**
 * Tiny dependency-free glyphs used by the shell (play/pause on the pill,
 * chevron on the player modal). Drawn with Views so they tint per theme.
 */
import React from "react";
import { View } from "react-native";

export const PlayGlyph = ({ color, size = 16 }: { color: string; size?: number }) => (
  <View
    style={{
      width: 0,
      height: 0,
      marginLeft: size * 0.15,
      borderTopWidth: size * 0.55,
      borderBottomWidth: size * 0.55,
      borderLeftWidth: size * 0.9,
      borderTopColor: "transparent",
      borderBottomColor: "transparent",
      borderLeftColor: color,
    }}
  />
);

export const PauseGlyph = ({ color, size = 16 }: { color: string; size?: number }) => (
  <View style={{ flexDirection: "row", gap: size * 0.28 }}>
    <View
      style={{
        width: size * 0.3,
        height: size * 1.05,
        borderRadius: size * 0.1,
        backgroundColor: color,
      }}
    />
    <View
      style={{
        width: size * 0.3,
        height: size * 1.05,
        borderRadius: size * 0.1,
        backgroundColor: color,
      }}
    />
  </View>
);

export const ChevronDownGlyph = ({ color, size = 24 }: { color: string; size?: number }) => (
  <View style={{ width: size, height: size * 0.5, flexDirection: "row", justifyContent: "center" }}>
    <View
      style={{
        width: size * 0.55,
        height: size * 0.12,
        borderRadius: size * 0.06,
        backgroundColor: color,
        transform: [{ rotate: "35deg" }, { translateX: size * 0.1 }],
      }}
    />
    <View
      style={{
        width: size * 0.55,
        height: size * 0.12,
        borderRadius: size * 0.06,
        backgroundColor: color,
        transform: [{ rotate: "-35deg" }, { translateX: -size * 0.1 }],
      }}
    />
  </View>
);
