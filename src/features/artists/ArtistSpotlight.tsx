/**
 * Artists-hub spotlight (FR-36), editorial since the 2026-11-04 redesign:
 * ONE big photo of the artist the user plays most, the name big over its
 * bottom edge on a plain dark scrim, a grey meta line, and the play disc.
 * No gradient card, no colour: with no photo the surface is the flat
 * neutral `secondary` and the name sits on it in the normal ink.
 *
 * Telemóvel: the photo runs edge to edge (no rounded box). Computador: it
 * sits on the page gutter, capped in height, with the usual small radius.
 */
import React from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import { Image } from "expo-image";
import type { ArtistOverview } from "@/domain/artist";
import { artistBannerSource } from "@/domain/artwork";
import { useT } from "@/i18n";
import { haptics } from "@/lib/haptics";
import { useTheme } from "@/theme/provider";
import { RADIUS } from "@/theme/tokens";
import {
  artworkSourceUri,
  GhostIconButton,
  gradientBackground,
  linearGradient,
  Icon,
  Skeleton,
  useContainerWidth,
  useDesktopShell,
} from "@/ui";
import { FadeIn, PressableScale } from "@/ui/motion";
import { pageType, useGutter } from "@/ui/page";

/** Photo ink: always white over the black scrim, whatever the theme. */
const PHOTO_INK = "#ffffff";
const PHOTO_META = "rgba(255,255,255,0.78)";
/** Black from the bottom: the name reads over any photo. */
const SCRIM = linearGradient("to top", "rgba(0,0,0,0.88)", "rgba(0,0,0,0.45) 45%", "rgba(0,0,0,0) 75%");

export interface ArtistSpotlightProps {
  spotlight: NonNullable<ArtistOverview["spotlight"]>;
  /** The lazy spotlight-songs query is still running. */
  isLoading?: boolean;
  onPlay: () => void;
  onShuffle: () => void;
  onOpenArtist: () => void;
  onStartRadio: () => void;
}

/** Photo height: about square on a phone, capped on bigger screens. */
const useSpotlightSize = () => {
  const desktop = useDesktopShell();
  const width = useContainerWidth();
  const { height } = useWindowDimensions();
  const gutter = useGutter();
  const photoWidth = desktop ? width - gutter * 2 : width;
  const photoHeight = Math.round(
    Math.min(photoWidth * (desktop ? 0.42 : 1.05), height * (desktop ? 0.5 : 0.62)),
  );
  return { desktop, gutter, photoHeight };
};

export const ArtistSpotlightSkeleton = () => {
  const { desktop, gutter, photoHeight } = useSpotlightSize();
  return (
    <View style={{ paddingHorizontal: desktop ? gutter : 0 }}>
      <Skeleton width="100%" height={photoHeight} borderRadius={desktop ? RADIUS : 0} />
    </View>
  );
};

export const ArtistSpotlight = ({
  spotlight,
  isLoading = false,
  onPlay,
  onShuffle,
  onOpenArtist,
  onStartRadio,
}: ArtistSpotlightProps) => {
  const t = useT();
  const { tokens } = useTheme();
  const { desktop, gutter, photoHeight } = useSpotlightSize();
  const { artist } = spotlight;
  const backdrop = artworkSourceUri(artistBannerSource(artist));
  const nameSize = artist.name.length > 22 ? 36 : artist.name.length > 12 ? 44 : 56;

  const ink = backdrop ? PHOTO_INK : tokens.foreground;
  const meta = backdrop ? PHOTO_META : tokens.mutedForeground;
  const metaLine = [
    t("components.music.Artists.songsCount", { count: spotlight.songs_count }),
    t("components.music.Artists.albumsCount", { count: spotlight.albums_count }),
    spotlight.play_count > 0
      ? t("components.music.Artists.playsCount", { count: spotlight.play_count })
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <View style={{ paddingHorizontal: desktop ? gutter : 0 }}>
      <View
        style={{
          height: photoHeight,
          borderRadius: desktop ? RADIUS : 0,
          overflow: "hidden",
          justifyContent: "flex-end",
          backgroundColor: tokens.secondary,
        }}
      >
        {backdrop ? (
          <FadeIn duration={320} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
            <Image
              source={{ uri: backdrop }}
              contentFit="cover"
              transition={0}
              style={{ width: "100%", height: "100%" }}
              accessible={false}
            />
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                ...gradientBackground(SCRIM),
              }}
            />
          </FadeIn>
        ) : null}
        <View style={{ paddingHorizontal: gutter, paddingBottom: 20, gap: 6 }}>
          <Text style={[pageType.label, { color: meta }]}>
            {t("components.music.Artists.spotlightLabel")}
          </Text>
          <Pressable onPress={onOpenArtist} accessibilityRole="link" hitSlop={4}>
            {({ pressed }) => (
              <Text
                style={{
                  color: ink,
                  fontSize: nameSize,
                  lineHeight: Math.round(nameSize * 1.02),
                  fontWeight: "800",
                  letterSpacing: -1.2,
                  opacity: pressed ? 0.7 : 1,
                }}
                numberOfLines={2}
              >
                {artist.name}
              </Text>
            )}
          </Pressable>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 6 }}>
            <Text style={[pageType.meta, { color: meta, flex: 1, minWidth: 0 }]} numberOfLines={2}>
              {metaLine}
            </Text>
            <GhostIconButton
              icon="radio"
              color={ink}
              onPress={() => {
                haptics.select();
                onStartRadio();
              }}
              accessibilityLabel={t("components.music.Artists.radioSpotlight")}
            />
            <GhostIconButton
              icon="shuffle"
              color={ink}
              disabled={isLoading}
              onPress={() => {
                haptics.tap();
                onShuffle();
              }}
              accessibilityLabel={t("components.music.Artists.shuffleSpotlight")}
            />
            <PressableScale
              onPress={() => {
                if (isLoading) return;
                haptics.tap();
                onPlay();
              }}
              accessibilityRole="button"
              accessibilityLabel={t("components.music.Artists.playSpotlight")}
              hitSlop={4}
              style={{
                width: 52,
                height: 52,
                borderRadius: 26,
                backgroundColor: backdrop ? PHOTO_INK : tokens.primary,
                alignItems: "center",
                justifyContent: "center",
                opacity: isLoading ? 0.6 : 1,
              }}
            >
              <Icon name="play" size={22} color={backdrop ? "#000000" : tokens.primaryForeground} filled />
            </PressableScale>
          </View>
        </View>
      </View>
    </View>
  );
};
