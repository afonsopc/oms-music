/**
 * Presentational MiniPlayer pill body (FR-16 visual language): 64pt
 * rounded-xl floating card with 40pt artwork, title/artists, a cast slot,
 * play/pause and a 2px progress line along the bottom edge. WP2's shell
 * wires it to the player store and the transport contract; this component
 * stays store-free.
 */
import React from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { ArtworkImage } from "./ArtworkImage";
import { Icon } from "./icons";
import { backgroundVeil, heavyShadow } from "./uiTheme";
import type { ArtworkSource } from "@/domain/artwork";
import { useTheme } from "@/theme/provider";

export interface MiniPlayerPillProps {
  title: string;
  artistsLine: string;
  artwork?: ArtworkSource | null;
  songId?: number | null;
  playing: boolean;
  buffering?: boolean;
  /** 0..1 */
  progress: number;
  onPress: () => void;
  onTogglePlay: () => void;
  playLabel: string;
  pauseLabel: string;
  /** Cast button slot (DevicePicker trigger, WP9). */
  castSlot?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export const MiniPlayerPill = ({
  title,
  artistsLine,
  artwork,
  songId,
  playing,
  buffering = false,
  progress,
  onPress,
  onTogglePlay,
  playLabel,
  pauseLabel,
  castSlot,
  style,
}: MiniPlayerPillProps) => {
  const { tokens, scheme } = useTheme();
  const clamped = Math.max(0, Math.min(1, progress));

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={[
        {
          height: 64,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: tokens.border,
          backgroundColor: backgroundVeil(scheme, 0.95),
          overflow: "hidden",
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingHorizontal: 10,
        },
        heavyShadow,
        style,
      ]}
    >
      <ArtworkImage source={artwork} songId={songId} size={40} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={{ color: tokens.foreground, fontSize: 14, fontWeight: "600" }}
          numberOfLines={1}
        >
          {title}
        </Text>
        <Text style={{ color: tokens.mutedForeground, fontSize: 12 }} numberOfLines={1}>
          {artistsLine}
        </Text>
      </View>
      {castSlot}
      <Pressable
        onPress={onTogglePlay}
        accessibilityRole="button"
        accessibilityLabel={playing ? pauseLabel : playLabel}
        hitSlop={8}
        style={({ pressed }) => ({
          width: 40,
          height: 40,
          alignItems: "center",
          justifyContent: "center",
          opacity: pressed ? 0.6 : 1,
        })}
      >
        {buffering ? (
          <ActivityIndicator size="small" color={tokens.foreground} />
        ) : (
          <Icon name={playing ? "pause" : "play"} size={22} color={tokens.foreground} filled />
        )}
      </Pressable>
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: 0,
          bottom: 0,
          height: 2,
          width: `${clamped * 100}%`,
          backgroundColor: tokens.primary,
        }}
      />
    </Pressable>
  );
};
