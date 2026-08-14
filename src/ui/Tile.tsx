/**
 * Rail card (web Tile parity): 176pt wide, square or circular artwork with
 * shadow, optional play FAB, semibold title + muted subtitle. Missing
 * artwork falls through to the shared placeholder photo inside ArtworkImage
 * (never an icon).
 *
 * The FAB is always visible on touch (there is no hover); in the desktop
 * shell it is a hover/focus reveal (plan 4.3) - mounted the whole time so
 * revealing never reflows the card, and reachable by keyboard because the
 * card's focus-within tracking counts as hover.
 */
import React, { useState } from "react";
import { Platform, Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { cardFocusProps, cardKeyProps, cardPressRole } from "./a11y";
import { ArtworkImage } from "./ArtworkImage";
import { PlayFab } from "./buttons";
import { useDesktopShell } from "./shellLayout";
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
  const desktopShell = useDesktopShell();
  const [hovered, setHovered] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const artSize = width - 24;
  // Below 900px (and on native) this is constant true: the shipped
  // always-visible FAB, untouched.
  const revealFab = !desktopShell || hovered || focusWithin;

  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      accessibilityRole={cardPressRole}
      accessibilityLabel={title}
      {...cardKeyProps(onPress)}
      {...cardFocusProps(
        () => setFocusWithin(true),
        () => setFocusWithin(false),
      )}
      style={({ pressed }) => [
        {
          width,
          padding: 12,
          borderRadius: RADIUS,
          gap: 12,
          ...(Platform.OS === "web" ? { cursor: "pointer" as const } : null),
          backgroundColor:
            pressed || (desktopShell && hovered)
              ? foregroundWash(scheme, 0.05)
              : "transparent",
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
          // Opacity + pointerEvents, never unmount: the reveal must not
          // reflow, and a hidden FAB must not swallow the click meant for
          // the card underneath it.
          <View
            pointerEvents={revealFab ? "auto" : "none"}
            style={{
              position: "absolute",
              bottom: 8,
              right: 8,
              opacity: revealFab ? 1 : 0,
            }}
          >
            <PlayFab
              onPress={onPlay}
              size={40}
              accessibilityLabel={t("components.music.Tile.play")}
            />
          </View>
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
