/**
 * Home top tiles (web HomeTopTiles parity): up to 8 wide 64pt-tall
 * horizontal cards in a responsive grid - square artwork on the left,
 * bold truncated title, optional play FAB.
 */
import React from "react";
import { Pressable, Text, useWindowDimensions, View, type StyleProp, type ViewStyle } from "react-native";
import { cardPressRole } from "./a11y";
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
/** Phones show an even count so the two-column grid never ends ragged. */
const MAX_ITEMS_NARROW = 8;

export const TopTileGrid = ({ items, style }: TopTileGridProps) => {
  const { tokens, scheme } = useTheme();
  const t = useT();
  const { width } = useWindowDimensions();
  // A phone used to fall to ONE column, which turned these shortcuts into
  // eight full-width rows filling the screen before anything else. Two
  // columns is the phone idiom for this exact control, and eight of them leave
  // room for the rails underneath.
  const columns = width >= 1280 ? 4 : width >= 1024 ? 3 : 2;
  const limit = width >= 640 ? MAX_ITEMS : MAX_ITEMS_NARROW;

  return (
    <View
      style={[
        { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 24 },
        style,
      ]}
    >
      {items.slice(0, limit).map((item) => (
        <Pressable
          key={item.key}
          onPress={item.onPress}
          accessibilityRole={cardPressRole}
          accessibilityLabel={item.title}
          style={({ pressed }) => ({
            // -2%: the 8px gap is ABSOLUTE, and at phone widths 1% (~3.4px) did not
            // cover it - the second tile wrapped and the grid rendered ONE column.
            flexBasis: `${100 / columns - 2}%`,
            flexGrow: 1,
            height: 64,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            borderRadius: RADIUS,
            overflow: "hidden",
            backgroundColor: foregroundWash(scheme, pressed ? 0.14 : 0.08),
          })}
        >
          <ArtworkImage source={item.artwork} size={64} shape="square" />
          <Text
            style={{ flex: 1, color: tokens.foreground, fontSize: 15, fontWeight: "600" }}
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
