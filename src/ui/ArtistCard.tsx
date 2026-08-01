/**
 * Grid artist card (web ArtistCard parity): circular avatar + centered
 * name. With no picture the deterministic initials disc renders (the ONLY
 * legal initials surface, FR-21). A `loading` state covers the Deezer
 * picture lookup for derived name-only cards.
 */
import React from "react";
import { Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { ArtworkImage } from "./ArtworkImage";
import { CircleSkeleton } from "./skeletons";
import type { ArtworkSource } from "@/domain/artwork";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";

export interface ArtistCardProps {
  name: string;
  /** artistImageSource(artist, "sm") result, or an external picture URI. */
  image?: ArtworkSource | null;
  imageUri?: string | null;
  loading?: boolean;
  size?: number;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}

export const ArtistCard = ({
  name,
  image,
  imageUri,
  loading = false,
  size = 120,
  onPress,
  style,
}: ArtistCardProps) => {
  const { tokens } = useTheme();
  const t = useT();
  const source: ArtworkSource | null =
    image ?? (imageUri ? { kind: "external", url: imageUri } : { kind: "initials", name });

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={name || t("components.music.ArtistCard.unknownArtist")}
      style={({ pressed }) => [
        { width: size + 16, alignItems: "center", gap: 8, opacity: pressed ? 0.7 : 1 },
        style,
      ]}
    >
      {loading ? (
        <CircleSkeleton size={size} />
      ) : (
        <ArtworkImage source={source} size={size} shape="circle" />
      )}
      <View style={{ width: "100%" }}>
        <Text
          style={{
            color: tokens.foreground,
            fontSize: 14,
            fontWeight: "500",
            textAlign: "center",
          }}
          numberOfLines={1}
        >
          {name || t("components.music.ArtistCard.unknownArtist")}
        </Text>
      </View>
    </Pressable>
  );
};
