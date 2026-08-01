/**
 * Artists-hub spotlight banner (FR-36): a full-bleed rounded card for the
 * artist the user plays most, so the page opens on something rather than on
 * the letter A. Backdrop = the artist banner chain; with no photo the fixed
 * fuchsia/violet/indigo gradient stands in. The surface is always dark, so
 * the label, the name and the controls are hard-coded white (they never sit
 * on a themed background).
 */
import React from "react";
import { ActivityIndicator, Pressable, Text, useWindowDimensions, View } from "react-native";
import { Image } from "expo-image";
import type { ArtistOverview } from "@/domain/artist";
import { artistBannerSource } from "@/domain/artwork";
import { useT } from "@/i18n";
import { RADIUS } from "@/theme/tokens";
import { artworkSourceUri, GhostIconButton, Icon, linearGradient } from "@/ui";

const SPOTLIGHT_GRADIENT = ["#a21caf", "#6d28d9", "#3730a3"] as const; // fuchsia-700 violet-700 indigo-800

export interface ArtistSpotlightProps {
  spotlight: NonNullable<ArtistOverview["spotlight"]>;
  /** The lazy spotlight-songs query is still running. */
  isLoading?: boolean;
  onPlay: () => void;
  onShuffle: () => void;
  onOpenArtist: () => void;
  onStartRadio: () => void;
}

export const ArtistSpotlight = ({
  spotlight,
  isLoading = false,
  onPlay,
  onShuffle,
  onOpenArtist,
  onStartRadio,
}: ArtistSpotlightProps) => {
  const t = useT();
  const { height } = useWindowDimensions();
  const { artist } = spotlight;
  const backdrop = artworkSourceUri(artistBannerSource(artist));
  const minHeight = Math.round(height * 0.34);
  const nameSize = artist.name.length > 18 ? 34 : 44;

  return (
    <View
      style={{
        minHeight,
        borderRadius: RADIUS * 1.5,
        overflow: "hidden",
        justifyContent: "flex-end",
      }}
    >
      {backdrop ? (
        <Image
          source={{ uri: backdrop }}
          contentFit="cover"
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
          accessible={false}
        />
      ) : null}
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          experimental_backgroundImage: backdrop
            ? // Dark enough at the bottom for white text over any photo.
              linearGradient(
                "to top",
                "rgba(0, 0, 0, 0.9)",
                "rgba(0, 0, 0, 0.55)",
                "rgba(0, 0, 0, 0.2)",
              )
            : linearGradient("135deg", ...SPOTLIGHT_GRADIENT),
        }}
      />
      <View style={{ padding: 20, gap: 10 }}>
        <Text
          style={{
            color: "rgba(255, 255, 255, 0.75)",
            fontSize: 12,
            fontWeight: "600",
            textTransform: "uppercase",
            letterSpacing: 0.6,
          }}
        >
          {t("components.music.Artists.spotlightLabel")}
        </Text>
        <Pressable onPress={onOpenArtist} accessibilityRole="link" hitSlop={4}>
          <Text
            style={{
              color: "#ffffff",
              fontSize: nameSize,
              lineHeight: nameSize * 1.05,
              fontWeight: "900",
              letterSpacing: -0.8,
            }}
            numberOfLines={2}
          >
            {artist.name}
          </Text>
        </Pressable>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <Text style={{ color: "rgba(255, 255, 255, 0.85)", fontSize: 13 }}>
            {t("components.music.Artists.songsCount", { count: spotlight.songs_count })}
          </Text>
          <Text style={{ color: "rgba(255, 255, 255, 0.6)", fontSize: 13 }}>•</Text>
          <Text style={{ color: "rgba(255, 255, 255, 0.85)", fontSize: 13 }}>
            {t("components.music.Artists.albumsCount", { count: spotlight.albums_count })}
          </Text>
          {spotlight.play_count > 0 ? (
            <>
              <Text style={{ color: "rgba(255, 255, 255, 0.6)", fontSize: 13 }}>•</Text>
              <Text style={{ color: "rgba(255, 255, 255, 0.85)", fontSize: 13 }}>
                {t("components.music.Artists.playsCount", { count: spotlight.play_count })}
              </Text>
            </>
          ) : null}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 }}>
          <Pressable
            onPress={onPlay}
            disabled={isLoading}
            accessibilityRole="button"
            accessibilityLabel={t("components.music.Artists.playSpotlight")}
            style={({ pressed }) => ({
              width: 48,
              height: 48,
              borderRadius: 24,
              backgroundColor: "#ffffff",
              alignItems: "center",
              justifyContent: "center",
              transform: [{ scale: pressed ? 0.96 : 1 }],
            })}
          >
            {isLoading ? (
              <ActivityIndicator color="#000000" />
            ) : (
              <Icon name="play" size={20} color="#000000" filled />
            )}
          </Pressable>
          <GhostIconButton
            icon="shuffle"
            color="#ffffff"
            disabled={isLoading}
            onPress={onShuffle}
            accessibilityLabel={t("components.music.Artists.shuffleSpotlight")}
          />
          <GhostIconButton
            icon="radio"
            color="#ffffff"
            onPress={onStartRadio}
            accessibilityLabel={t("components.music.Artists.radioSpotlight")}
          />
        </View>
      </View>
    </View>
  );
};
