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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArtworkImage, artworkSourceUri } from "./ArtworkImage";
import { heroMinHeight, heroTitleType } from "./breakpoints";
import { InitialsAvatar } from "./InitialsAvatar";
import { useContainerWidth, useDesktopShell } from "./shellLayout";
import { gradientBackground, linearGradient } from "./uiTheme";
import type { ArtworkSource } from "@/domain/artwork";
import { useT } from "@/i18n";
import { getCachedAccent, resolveAccent } from "@/theme/accent";
import { onColor, withAlpha } from "@/theme/contrast";
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

interface HeroContentProps {
  desktopRow: boolean;
  insetsTop: number;
  containerWidth: number;
  artSize: number;
  artistAvatarFallback: boolean;
  isArtistBackdrop: boolean;
  image: ArtworkSource | null;
  artworkSlot?: React.ReactNode;
  title: string;
  kindLine: string;
  meta?: React.ReactNode;
  titleType: { fontSize: number; lineHeight: number };
  ink: string;
  kindInk: string;
  metaInk: string;
  metaSize: number;
}

/**
 * The hero's content in its two arrangements. MOBILE keeps the shipped
 * vertical stack (artwork above the title, frozen below 900px). The DESKTOP
 * shell lays it out like Spotify's playlist header (owner screenshots
 * 2026-08-14): artwork on the LEFT, and to its right a bottom-aligned column
 * of kind line, display title and meta - the title beside the artwork, never
 * under it, so a 96px display face reads as a header instead of a wall.
 */
const HeroContent = ({
  desktopRow,
  insetsTop,
  containerWidth,
  artSize,
  artistAvatarFallback,
  isArtistBackdrop,
  image,
  artworkSlot,
  title,
  kindLine,
  meta,
  titleType,
  ink,
  kindInk,
  metaInk,
  metaSize,
}: HeroContentProps) => {
  // Spotify scales the cover with the pane: ~18% of the width, clamped so a
  // narrow pane still shows a real cover and an ultrawide does not poster it.
  const rowArtSize = Math.round(Math.min(232, Math.max(160, containerWidth * 0.18)));
  const size = desktopRow ? rowArtSize : artSize;

  const artwork = artistAvatarFallback ? (
    image && image.kind !== "initials" ? (
      <ArtworkImage source={image} size={size} shape="circle" />
    ) : (
      <InitialsAvatar name={title} size={size} />
    )
  ) : !isArtistBackdrop ? (
    artworkSlot ? (
      <View style={{ width: size, height: size }}>{artworkSlot}</View>
    ) : image ? (
      <ArtworkImage source={image} size={size} borderRadius={RADIUS + 4} />
    ) : null
  ) : null;

  const textBlock = (
    <View style={{ gap: 6, flexShrink: 1, minWidth: 0, flexGrow: desktopRow ? 1 : 0 }}>
      <Text style={[typeScale.kindLabel, { color: kindInk }]}>{kindLine}</Text>
      <Text
        style={{
          color: ink,
          fontSize: titleType.fontSize,
          lineHeight: titleType.lineHeight,
          fontWeight: "900",
          letterSpacing: -0.5,
        }}
        numberOfLines={desktopRow ? 2 : 3}
      >
        {title}
      </Text>
      {meta ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          {typeof meta === "string" ? (
            <Text style={{ color: metaInk, fontSize: metaSize }}>{meta}</Text>
          ) : (
            meta
          )}
        </View>
      ) : null}
    </View>
  );

  if (desktopRow) {
    return (
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          gap: 24,
          paddingHorizontal: 24,
          paddingTop: insetsTop + 24,
          paddingBottom: 20,
        }}
      >
        {artwork}
        {textBlock}
      </View>
    );
  }

  return (
    <View
      style={{
        paddingHorizontal: 24,
        paddingTop: insetsTop + 24,
        paddingBottom: 12,
        gap: 16,
      }}
    >
      {artwork}
      {textBlock}
    </View>
  );
};

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

  /**
   * Where the text actually sits decides its color. On an artist backdrop the
   * scrim is the accent at full strength behind the whole text block, so the
   * ink has to be derived from that accent - a mid-tone artwork left
   * `foreground` at roughly 3:1 and made the meta line unreadable. Every other
   * hero fades to transparent by the time it reaches the text, so the text is
   * effectively on `background` and the plain foreground token is correct.
   *
   * Alphas are baked into the color rather than applied with `opacity` so the
   * result is a value the contrast helpers can measure - and they are only
   * spent where there is headroom to spend. There is very little: the text
   * block sits low in the fade but the accent is still under it, and the
   * worst case in the sweep (the deep purple section accent at 60% over the
   * light page) leaves the kind label at 4.65:1 and the meta line at 4.86:1.
   * A further 5% off either one drops it under AA, so the hierarchy here
   * leans on size, weight and case rather than on more alpha.
   */
  const ink = isArtistBackdrop ? onColor(accent) : tokens.foreground;
  const kindInk = isArtistBackdrop ? ink : withAlpha(ink, 0.88);
  const metaInk = isArtistBackdrop ? ink : withAlpha(ink, 0.92);

  const insets = useSafeAreaInsets();
  const desktopShell = useDesktopShell();
  const containerWidth = useContainerWidth();
  /**
   * Two geometry regimes (plan 4.3, collection row). Mobile keeps the
   * shipped height fractions untouched - the sacred below-900px freeze. The
   * desktop shell swaps to a WIDTH-dependent cap (breakpoints.heroMinHeight)
   * because a fraction of a 1440p monitor is a ~500px band of nothing, and
   * to the 96/72/32 type ramp keyed on the main pane's bucket instead of
   * the mobile 28/34 title-length pair.
   */
  const minHeight = desktopShell
    ? heroMinHeight(containerWidth, isArtistBackdrop) + insets.top
    : Math.round(height * (isArtistBackdrop ? 0.42 : 0.36)) + insets.top;
  const titleType = desktopShell
    ? heroTitleType(containerWidth, title.length)
    : {
        fontSize: title.length > 24 ? 28 : 34,
        lineHeight: title.length > 24 ? 32 : 38,
      };
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
          ...gradientBackground(
            isArtistBackdrop
              ? linearGradient("to top", `${accent} 0%`, `${accent}cc 25%`, "transparent 90%")
              : linearGradient("to bottom", accent, "transparent"),
          ),
        }}
      />
      {/* Desktop contrast guarantee (owner report 2026-08-14): the desktop
          hero is width-capped and SHORTER than the mobile fraction, so the
          accent has not fully faded by the time it reaches the text block -
          a bright accent left the meta line swimming on it. This scrim
          settles the bottom of the gradient back onto `background`, which is
          the surface the foreground tokens are measured against. The artist
          backdrop keeps its own accent scrim + onColor ink; mobile keeps the
          shipped fade untouched. */}
      {desktopShell && !isArtistBackdrop ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            ...gradientBackground(
              linearGradient(
                "to top",
                `${withAlpha(tokens.background, 0.92)} 0%`,
                "transparent 65%",
              ),
            ),
          }}
        />
      ) : null}
      {/* The gradient and any backdrop bleed to the very top on purpose, but
          the CONTENT must clear the status bar and the dynamic island: this
          hero is the shared header of every collection screen, so without the
          inset the artwork of playlists, albums, mixes and radios all sat
          under the island. */}
      <HeroContent
        desktopRow={desktopShell && !isArtistBackdrop}
        insetsTop={insets.top}
        containerWidth={containerWidth}
        artSize={artSize}
        artistAvatarFallback={artistAvatarFallback}
        isArtistBackdrop={isArtistBackdrop}
        image={image ?? null}
        artworkSlot={artworkSlot}
        title={title}
        kindLine={subtitle ?? t(`components.music.Hero.${kind}`)}
        meta={meta}
        titleType={titleType}
        ink={ink}
        kindInk={kindInk}
        metaInk={metaInk}
        metaSize={desktopShell ? 14 : 13}
      />
    </View>
  );
};
