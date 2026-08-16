/**
 * Mix tile (web MixTile parity): kind gradient square, optional artist
 * photo under a dark scrim (dark at BOTH ends so the white icon and stamp
 * stay readable over light portraits), kind icon top-left, uppercase stamp
 * text stepped down by length, then title + 2-line description. Titles and
 * descriptions arrive already localized (i18n/mixLabels, FR-121) - the
 * server English fallbacks must never reach this component.
 */
import React from "react";
import { Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Image } from "expo-image";
import { Icon, type IconName } from "./icons";
import { foregroundWash, gradientBackground, linearGradient } from "./uiTheme";
import type { MixKind } from "@/domain/mixes";
import { AA_LARGE, ON_DARK, preferredOn } from "@/theme/contrast";
import { MIX_TILE_SCRIM } from "@/theme/gradients";
import { useTheme } from "@/theme/provider";
import { MIX_KIND_GRADIENTS, RADIUS } from "@/theme/tokens";
import { typeScale } from "@/theme/typography";
import { TILE_WIDTH } from "./Tile";

/** Stamp text size stepped by length (web stampSizeClass). */
export const stampFontSize = (text: string): number => {
  if (text.length <= 8) return 30;
  if (text.length <= 14) return 24;
  if (text.length <= 22) return 20;
  return 16;
};

/** Stamp text: artist name (top_artist), "<seed>s" (time_capsule), else title. */
export const mixStampText = (
  kind: MixKind,
  title: string,
  artistName?: string | null,
  seed?: string | number | null,
): string => {
  if ((kind === "top_artist" || kind === "this_is") && artistName) return artistName;
  if (kind === "time_capsule" && seed != null) return `${seed}s`;
  if (kind === "year_mix" && seed != null) return `${seed}`;
  return title;
};

export interface MixTileArtworkProps {
  kind: MixKind;
  stamp: string;
  /** Artist photo URI layered over the gradient (top_artist mixes). */
  artworkUri?: string | null;
  size: number;
  /** Override the kind icon (radios reuse this tile with a radio icon). */
  icon?: IconName;
}

/** The gradient square alone (also used as a Hero artworkSlot). */
export const MixTileArtwork = ({ kind, stamp, artworkUri, size, icon }: MixTileArtworkProps) => {
  const gradient = MIX_KIND_GRADIENTS[kind];
  // Over a photo the surface is the scrim (dark at both ends by design); with
  // no photo it is the kind gradient's middle stop. The stamp is display type
  // (weight 900, 16-30px) so the large-text threshold is the right bar, and
  // white clears it on all four kind gradients.
  const ink = preferredOn(
    artworkUri ? MIX_TILE_SCRIM[2] : gradient.colors[1],
    ON_DARK,
    AA_LARGE,
  );
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: RADIUS,
        overflow: "hidden",
        padding: 12,
        justifyContent: "space-between",
        ...gradientBackground(linearGradient("135deg", ...gradient.colors)),
      }}
    >
      {artworkUri ? (
        <>
          <Image
            source={{ uri: artworkUri }}
            contentFit="cover"
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
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
              ...gradientBackground(linearGradient("to bottom", ...MIX_TILE_SCRIM)),
            }}
          />
        </>
      ) : null}
      <Icon name={icon ?? gradient.icon} size={24} color={ink} />
      <Text
        style={{
          color: ink,
          fontWeight: "900",
          textTransform: "uppercase",
          letterSpacing: -0.4,
          fontSize: stampFontSize(stamp),
          lineHeight: stampFontSize(stamp) * 1.02,
        }}
        numberOfLines={3}
      >
        {stamp}
      </Text>
    </View>
  );
};

export interface MixTileProps {
  kind: MixKind;
  /** Localized title (title_key through i18n, NEVER the payload English). */
  title: string;
  /** Localized description. */
  description: string;
  stamp: string;
  artworkUri?: string | null;
  onPress: () => void;
  /** Nome do artista DENTRO da descrição; com onPressArtist, esse troço
   *  torna-se clicável e abre o perfil (pedido do dono, 2026-08-17). */
  artistName?: string | null;
  onPressArtist?: () => void;
  width?: number;
  style?: StyleProp<ViewStyle>;
}

export const MixTile = ({
  kind,
  title,
  description,
  stamp,
  artworkUri,
  onPress,
  artistName,
  onPressArtist,
  width = TILE_WIDTH,
  style,
}: MixTileProps) => {
  const { tokens, scheme } = useTheme();
  const artSize = width - 24;

  // O nome do artista na descrição abre o perfil dele; o resto do cartão
  // continua a abrir o mix. Nested Text e não um layout novo: a descrição
  // continua a truncar como um parágrafo de duas linhas. Se a string
  // localizada não contiver o nome (um catálogo que o parafraseie), o cartão
  // degrada para texto simples em vez de partir.
  const descriptionContent = (() => {
    if (!artistName || !onPressArtist) return description;
    const at = description.indexOf(artistName);
    if (at < 0) return description;
    return (
      <>
        {description.slice(0, at)}
        <Text
          accessibilityRole="link"
          style={{ color: tokens.foreground, fontWeight: "600" }}
          onPress={(event) => {
            // Na web o clique borbulharia ate ao Pressable do cartao e
            // abriria o mix por cima da navegacao para o artista.
            (event as { stopPropagation?: () => void }).stopPropagation?.();
            onPressArtist();
          }}
        >
          {artistName}
        </Text>
        {description.slice(at + artistName.length)}
      </>
    );
  })();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => [
        {
          width,
          padding: 12,
          borderRadius: RADIUS,
          gap: 12,
          backgroundColor: pressed ? foregroundWash(scheme, 0.05) : "transparent",
        },
        style,
      ]}
    >
      <MixTileArtwork kind={kind} stamp={stamp} artworkUri={artworkUri} size={artSize} />
      <View style={{ gap: 2, minWidth: 0 }}>
        <Text style={[typeScale.tileTitle, { color: tokens.foreground }]} numberOfLines={1}>
          {title}
        </Text>
        <Text
          style={[typeScale.tileSubtitle, { color: tokens.mutedForeground }]}
          numberOfLines={2}
        >
          {descriptionContent}
        </Text>
      </View>
    </Pressable>
  );
};
