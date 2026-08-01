/**
 * Collection/artist hero header (web Hero parity). Non-artist heroes:
 * min-height 36% of the window with a square artwork and a top-down accent
 * gradient. Artist heroes with a backdrop photo: 42% full-bleed with a
 * bottom-up scrim in the accent. Accent: caller-provided `accentColor`
 * wins (mixes, liked, radios); otherwise the hero accent variant is
 * extracted from the backdrop/image (theme/accent.ts, dual-variant cache).
 */
import React, { useEffect, useState } from "react";
import { Text, useWindowDimensions, View, type StyleProp, type ViewStyle } from "react-native";
import { Image } from "expo-image";
import { ArtworkImage, artworkSourceUri } from "./ArtworkImage";
import { InitialsAvatar } from "./InitialsAvatar";
import { linearGradient } from "./uiTheme";
import type { ArtworkSource } from "@/domain/artwork";
import { useT } from "@/i18n";
import { getCachedAccent, resolveAccent } from "@/theme/accent";
import { useTheme } from "@/theme/provider";
import { HERO_FALLBACK, RADIUS } from "@/theme/tokens";
import { typeScale } from "@/theme/typography";

export type HeroKind = "playlist" | "album" | "artist" | "mix" | "radio";

export interface HeroProps {
  kind: HeroKind;
  title: string;
  /** Uppercase kind line; defaults to the localized kind label. */
  subtitle?: string;
  /** Dot-separated meta row (counts, links...) as text or nodes. */
  meta?: React.ReactNode;
  /** Square artwork (or circular avatar for artist without backdrop). */
  image?: ArtworkSource | null;
  /** Full-bleed backdrop photo URI (artist hero). */
  backdropUri?: string | null;
  /** Custom artwork slot (editable playlist artwork, mix stamp tile...). */
  artworkSlot?: React.ReactNode;
  /** Fixed accent (mixes, liked songs, radios without a photo). */
  accentColor?: string;
  /** Stable cache key for accent extraction (album key, artist id...). */
  accentKey?: string;
  style?: StyleProp<ViewStyle>;
}

export const Hero = ({
  kind,
  title,
  subtitle,
  meta,
  image,
  backdropUri,
  artworkSlot,
  accentColor,
  accentKey,
  style,
}: HeroProps) => {
  const { tokens, scheme } = useTheme();
  const t = useT();
  const { height } = useWindowDimensions();

  const isArtistBackdrop = kind === "artist" && !!backdropUri;
  const artistAvatarFallback = kind === "artist" && !backdropUri;
  const extractionUri = backdropUri ?? artworkSourceUri(image);

  const cached = accentKey ? getCachedAccent("hero", accentKey) : null;
  const [extracted, setExtracted] = useState<{ light: string; dark: string } | null>(cached);

  useEffect(() => {
    if (accentColor || !accentKey) return;
    let cancelled = false;
    void resolveAccent("hero", accentKey, extractionUri).then((variants) => {
      if (!cancelled) setExtracted(variants);
    });
    return () => {
      cancelled = true;
    };
  }, [accentColor, accentKey, extractionUri]);

  const accent = accentColor ?? (extracted ? extracted[scheme] : HERO_FALLBACK);

  const minHeight = Math.round(height * (isArtistBackdrop ? 0.42 : 0.36));
  const artSize = 136;

  return (
    <View style={[{ minHeight, justifyContent: "flex-end", overflow: "hidden" }, style]}>
      {isArtistBackdrop && backdropUri ? (
        <Image
          source={{ uri: backdropUri }}
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
          experimental_backgroundImage: isArtistBackdrop
            ? linearGradient("to top", `${accent} 0%`, `${accent}cc 25%`, "transparent 90%")
            : linearGradient("to bottom", accent, "transparent"),
        }}
      />
      <View style={{ paddingHorizontal: 24, paddingTop: 24, paddingBottom: 12, gap: 16 }}>
        {artistAvatarFallback ? (
          image && image.kind !== "initials" ? (
            <ArtworkImage source={image} size={artSize} shape="circle" />
          ) : (
            <InitialsAvatar name={title} size={artSize} />
          )
        ) : !isArtistBackdrop ? (
          artworkSlot ? (
            <View style={{ width: artSize, height: artSize }}>{artworkSlot}</View>
          ) : image ? (
            <ArtworkImage source={image} size={artSize} borderRadius={RADIUS + 4} />
          ) : null
        ) : null}
        <View style={{ gap: 6 }}>
          <Text
            style={[
              typeScale.kindLabel,
              { color: tokens.foreground, opacity: 0.8 },
            ]}
          >
            {subtitle ?? t(`components.music.Hero.${kind}`)}
          </Text>
          <Text
            style={{
              color: tokens.foreground,
              fontSize: title.length > 24 ? 28 : 34,
              lineHeight: title.length > 24 ? 32 : 38,
              fontWeight: "900",
              letterSpacing: -0.5,
            }}
            numberOfLines={3}
          >
            {title}
          </Text>
          {meta ? (
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 8,
              }}
            >
              {typeof meta === "string" ? (
                <Text style={{ color: tokens.foreground, opacity: 0.85, fontSize: 13 }}>
                  {meta}
                </Text>
              ) : (
                meta
              )}
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
};
