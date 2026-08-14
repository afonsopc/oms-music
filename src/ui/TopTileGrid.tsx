/**
 * Home top tiles (web HomeTopTiles parity): up to 8 wide 64pt-tall
 * horizontal cards in a responsive grid - square artwork on the left,
 * bold truncated title, optional play FAB. Each card is its own component
 * so the hover/focus reveal (desktop shell, plan 4.3) gets per-card hooks.
 */
import React, { useState } from "react";
import { Platform, Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { cardFocusProps, cardKeyProps, cardPressRole } from "./a11y";
import { topTileGridColumns } from "./breakpoints";
import { useContainerWidth, useDesktopShell } from "./shellLayout";
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

const TopTileCard = ({ item, columns }: { item: TopTileItem; columns: number }) => {
  const { tokens, scheme } = useTheme();
  const t = useT();
  const desktopShell = useDesktopShell();
  const [hovered, setHovered] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  // Touch keeps the always-visible FAB (the shipped card); desktop reveals
  // it on hover or focus-within, without unmounting so nothing reflows.
  const revealFab = !desktopShell || hovered || focusWithin;

  return (
    <Pressable
      onPress={item.onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      accessibilityRole={cardPressRole}
      accessibilityLabel={item.title}
      {...cardKeyProps(item.onPress)}
      {...cardFocusProps(
        () => setFocusWithin(true),
        () => setFocusWithin(false),
      )}
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
        // Web-only: RN honra `cursor` em iPads com trackpad, e a superficie
        // nativa congelada nao muda nem cosmeticamente.
        ...(Platform.OS === "web" ? { cursor: "pointer" as const } : null),
        backgroundColor: foregroundWash(
          scheme,
          pressed ? 0.14 : desktopShell && hovered ? 0.12 : 0.08,
        ),
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
        <View
          pointerEvents={revealFab ? "auto" : "none"}
          style={{ marginRight: 10, opacity: revealFab ? 1 : 0 }}
        >
          <PlayFab
            onPress={item.onPlay}
            size={36}
            accessibilityLabel={t("components.music.Tile.play")}
          />
        </View>
      ) : null}
    </Pressable>
  );
};

export const TopTileGrid = ({ items, style }: TopTileGridProps) => {
  // Container width, not window width (breakpoints.ts): inside the desktop
  // shell the main pane decides, on mobile the two are the same number.
  const width = useContainerWidth();
  // A phone used to fall to ONE column, which turned these shortcuts into
  // eight full-width rows filling the screen before anything else. Two
  // columns is the phone idiom for this exact control, and eight of them leave
  // room for the rails underneath. Ladder lives in breakpoints.ts.
  const columns = topTileGridColumns(width);
  const limit = width >= 640 ? MAX_ITEMS : MAX_ITEMS_NARROW;

  return (
    <View
      style={[
        { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 24 },
        style,
      ]}
    >
      {items.slice(0, limit).map((item) => (
        <TopTileCard key={item.key} item={item} columns={columns} />
      ))}
    </View>
  );
};
