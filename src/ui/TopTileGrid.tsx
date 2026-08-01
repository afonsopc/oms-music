/**
 * Home top tiles (web HomeTopTiles parity): up to 8 wide 64pt-tall
 * horizontal cards in a responsive grid - square artwork on the left,
 * bold truncated title, optional play FAB.
 */
import React from "react";
import { Pressable, Text, useWindowDimensions, View, type StyleProp, type ViewStyle } from "react-native";
import { ArtworkImage } from "./ArtworkImage";
import { PlayFab } from "./buttons";
import { foregroundWash } from "./uiTheme";
import type { ArtworkSource } from "@/domain/artwork";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import { RADIUS } from "@/theme/tokens";

export interface TopTileItem {
  key: string;
  title: string;
  artwork?: ArtworkSource | null;
  onPress: () => void;
  onPlay?: () => void;
}

export interface TopTileGridProps {
  items: TopTileItem[];
  style?: StyleProp<ViewStyle>;
}

const MAX_ITEMS = 8;

export const TopTileGrid = ({ items, style }: TopTileGridProps) => {
  const { tokens, scheme } = useTheme();
  const t = useT();
  const { width } = useWindowDimensions();
  const columns = width >= 1280 ? 4 : width >= 1024 ? 3 : width >= 640 ? 2 : 1;

  return (
    <View
      style={[
        { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 24 },
        style,
      ]}
    >
      {items.slice(0, MAX_ITEMS).map((item) => (
        <Pressable
          key={item.key}
          onPress={item.onPress}
          accessibilityRole="button"
          accessibilityLabel={item.title}
          style={({ pressed }) => ({
            flexBasis: columns === 1 ? "100%" : `${100 / columns - 1}%`,
            flexGrow: 1,
            height: 64,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            borderRadius: RADIUS,
            overflow: "hidden",
            backgroundColor: foregroundWash(scheme, pressed ? 0.1 : 0.05),
          })}
        >
          <ArtworkImage source={item.artwork} size={64} shape="square" />
          <Text
            style={{ flex: 1, color: tokens.foreground, fontSize: 14, fontWeight: "700" }}
            numberOfLines={2}
          >
            {item.title}
          </Text>
          {item.onPlay ? (
            <PlayFab
              onPress={item.onPlay}
              size={36}
              accessibilityLabel={t("components.music.Tile.play")}
              style={{ marginRight: 10 }}
            />
          ) : null}
        </Pressable>
      ))}
    </View>
  );
};
