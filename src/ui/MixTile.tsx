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
  // Ronda 2 (dono): de volta ao mosaico de imagem inteira, mais limpo. Com
  // foto, a foto enche o quadrado e um véu escuro em baixo segura o nome;
  // sem foto, uma capa gerada em carvão com o ícone do tipo em grande e
  // esbatido. O nome vai em letra normal (nada de maiúsculas a gritar).
  const fontSize = Math.round(stampFontSize(stamp) * (artworkUri ? (size >= 160 ? 0.88 : 0.76) : size >= 160 ? 1.15 : 0.95));
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: RADIUS,
        overflow: "hidden",
        justifyContent: "flex-end",
        ...gradientBackground(linearGradient("150deg", ...gradient.colors)),
      }}
    >
      {artworkUri ? (
        <Image
          alt=""
          source={{ uri: artworkUri }}
          contentFit="cover"
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
          accessible={false}
        />
      ) : (
        // Sem foto: uma capa tipográfica (ronda 2, pedido do dono): luz
        // suave num canto, o ícone pequeno no topo e o nome grande em baixo.
        <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
          <View
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              ...gradientBackground(`radial-gradient(circle at 78% 18%, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.04) 38%, rgba(0,0,0,0) 62%)`),
            }}
          />
          <View style={{ position: "absolute", top: 12, left: 12, flexDirection: "row", alignItems: "center", gap: 6, opacity: 0.75 }}>
            <Icon name={icon ?? gradient.icon} size={14} color="#ffffff" />
            <Text style={{ color: "#ffffff", fontSize: 11, fontWeight: "600", letterSpacing: 1.2 }}>MIX</Text>
          </View>
        </View>
      )}
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: "62%",
          ...gradientBackground(linearGradient("to bottom", "rgba(0,0,0,0) 0%", "rgba(0,0,0,0.45) 55%", "rgba(0,0,0,0.78) 100%")),
        }}
      />
      <Text
        style={{
          color: "#ffffff",
          fontWeight: "700",
          letterSpacing: -0.3,
          fontSize,
          lineHeight: Math.round(fontSize * 1.1),
          paddingHorizontal: 12,
          paddingBottom: 12,
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
