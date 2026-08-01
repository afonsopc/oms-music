/**
 * Small album card (web AlbumCard parity, search results): outline card
 * with 64pt artwork and a 2-line album name.
 */
import React from "react";
import { Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { ArtworkImage } from "./ArtworkImage";
import type { ArtworkSource } from "@/domain/artwork";
import { useTheme } from "@/theme/provider";
import { RADIUS } from "@/theme/tokens";

export interface AlbumCardProps {
  name: string;
  artwork?: ArtworkSource | null;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}

export const AlbumCard = ({ name, artwork, onPress, style }: AlbumCardProps) => {
  const { tokens } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={name}
      style={({ pressed }) => [
        {
          width: 112,
          height: 160,
          borderWidth: 1,
          borderColor: tokens.border,
          borderRadius: RADIUS,
          alignItems: "center",
          paddingTop: 16,
          paddingHorizontal: 10,
          gap: 10,
          opacity: pressed ? 0.7 : 1,
        },
        style,
      ]}
    >
      <ArtworkImage source={artwork} size={64} />
      <View style={{ width: "100%" }}>
        <Text
          style={{
            color: tokens.foreground,
            fontSize: 13,
            fontWeight: "500",
            textAlign: "center",
          }}
          numberOfLines={2}
        >
          {name}
        </Text>
      </View>
    </Pressable>
  );
};
