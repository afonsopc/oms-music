/**
 * A capa das Gostadas: o coração lilás sobre o tom calmo das Gostadas
 * (ronda 2, 2026-11-04; antes carvão, e antes disso roxo forte). Drawn by
 * BOTH the local Liked Songs surface and any synced liked-mirror playlist so
 * the two read as the same thing.
 */
import React from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { Icon } from "./icons";
import { useTheme } from "@/theme/provider";
import { LIKED_INK, LIKED_WASH, RADIUS } from "@/theme/tokens";

export interface LikedArtworkProps {
  size: number;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
}

export const LikedArtwork = ({ size, borderRadius = RADIUS, style }: LikedArtworkProps) => {
  const { scheme } = useTheme();
  return (
    <View
      accessible={false}
      style={[
        {
          width: size,
          height: size,
          borderRadius,
          overflow: "hidden",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: LIKED_WASH[scheme],
        },
        style,
      ]}
    >
      <Icon name="heart" size={size / 3} color={LIKED_INK[scheme]} filled />
    </View>
  );
};
