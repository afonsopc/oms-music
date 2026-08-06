/**
 * The purple heart tile: violet-700 -> purple-700 -> indigo-900 gradient
 * with a centered white heart at 1/3 size. Drawn by BOTH the local Liked
 * Songs surface and any Spotify liked-mirror playlist so the two read as
 * the same thing.
 */
import React from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { Icon } from "./icons";
import { linearGradient } from "./uiTheme";
import { AA_LARGE, ON_DARK, preferredOn } from "@/theme/contrast";
import { LIKED_GRADIENT, RADIUS } from "@/theme/tokens";

/** The heart sits over the middle stop; purple-700 keeps white in both schemes. */
const HEART_COLOR = preferredOn(LIKED_GRADIENT[1], ON_DARK, AA_LARGE);

export interface LikedArtworkProps {
  size: number;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
}

export const LikedArtwork = ({ size, borderRadius = RADIUS, style }: LikedArtworkProps) => (
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
        experimental_backgroundImage: linearGradient("135deg", ...LIKED_GRADIENT),
      },
      style,
    ]}
  >
    <Icon name="heart" size={size / 3} color={HEART_COLOR} filled />
  </View>
);
