/**
 * The one icon primitive (no icon package is installed): the glyph table and
 * the SVG data-URI builder live in ui/iconSvg.ts (pure, bun-tested), this
 * file only renders them through expo-image.
 */
import React from "react";
import type { StyleProp } from "react-native";
import { Image, type ImageStyle } from "expo-image";
import { iconUri, type IconName } from "./iconSvg";

export { iconForHint, iconUri, toBase64, type IconName } from "./iconSvg";

export interface IconProps {
  name: IconName;
  size?: number;
  color: string;
  filled?: boolean;
  style?: StyleProp<ImageStyle>;
}

export const Icon = ({ name, size = 20, color, filled = false, style }: IconProps) => (
  <Image
    source={{ uri: iconUri(name, color, filled) }}
    style={[{ width: size, height: size }, style]}
    contentFit="contain"
    accessible={false}
  />
);
