/**
 * Rail card (web Tile parity): 176pt wide, square or circular artwork with
 * shadow, optional play FAB (always visible on touch - there is no hover),
 * semibold title + muted subtitle. Missing artwork falls through to the
 * shared placeholder photo inside ArtworkImage (never an icon).
 */
import React from "react";
import { Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { cardPressRole } from "./a11y";
import { ArtworkImage } from "./ArtworkImage";
import { PlayFab } from "./buttons";
import { foregroundWash, heavyShadow } from "./uiTheme";
import type { ArtworkSource } from "@/domain/artwork";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import { RADIUS } from "@/theme/tokens";
import { typeScale } from "@/theme/typography";

export const TILE_WIDTH = 176;

export interface TileProps {
  title: string;
  subtitle?: string;
  artwork?: ArtworkSource | null;
  shape?: "square" | "circle";
  onPress: () => void;
  onPlay?: () => void;
  width?: number;
  style?: StyleProp<ViewStyle>;
}

export const Tile = ({
  title,
  subtitle,
  artwork,
  shape = "square",
  onPress,
  onPlay,
  width = TILE_WIDTH,
  style,
}: TileProps) => {
  const { tokens, scheme } = useTheme();
  const t = useT();
  const artSize = width - 24;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={cardPressRole}
      accessibilityLabel={title}
      style={({ pressed }) => [
        {
          width,
          padding: 12,
          borderRadius: RADIUS,
          gap: 12,
          backgroundColor: pressed ? foregroundWash(scheme, 0.05) : "transparent",
        },
        style,
      ]}
    >
      <View style={{ width: artSize, height: artSize }}>
        <ArtworkImage
          source={artwork}
          size={artSize}
          shape={shape === "circle" ? "circle" : "rounded"}
          style={heavyShadow}
        />
        {onPlay ? (
          <PlayFab
            onPress={onPlay}
            size={40}
            accessibilityLabel={t("components.music.Tile.play")}
            style={{ position: "absolute", bottom: 8, right: 8 }}
          />
        ) : null}
      </View>
      <View style={{ gap: 2, minWidth: 0 }}>
        <Text
          style={[typeScale.tileTitle, { color: tokens.foreground }]}
          numberOfLines={1}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            style={[typeScale.tileSubtitle, { color: tokens.mutedForeground }]}
            numberOfLines={1}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
};
