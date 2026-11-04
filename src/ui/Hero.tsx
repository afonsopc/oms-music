/**
 * O cabeçalho das colecções (playlist, álbum, mix, rádio) e do artista.
 * Redesenho de 2026-11-04: neutro, sem gradientes de cor, a capa grande.
 *
 * Telemóvel (90 % do uso):
 *
 *   ┌──────────────────────────┐
 *   │                          │   capa quase da largura do ecrã
 *   │          capa            │   (margem da página dos dois lados)
 *   │                          │
 *   └──────────────────────────┘
 *   Título grande                  encostado à esquerda, 2 linhas no máximo
 *   (o) Dono / artista             cinzento
 *   Playlist · 5 músicas · 14 min  cinzento
 *
 * Artista com foto: a foto de ponta a ponta, a desvanecer para o fundo da
 * página, com o nome grande por cima, em baixo à esquerda.
 *
 * Computador: capa à esquerda e o texto ao lado, alinhado por baixo.
 *
 * `accentColor` e `accentKey` continuam aceites (os ecrãs passam-nos) mas já
 * não pintam nada: a cor vem só das próprias capas.
 */
import React from "react";
import {
  Pressable,
  Text,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArtworkImage } from "./ArtworkImage";
import { heroMinHeight, heroTitleType } from "./breakpoints";
import { InitialsAvatar } from "./InitialsAvatar";
import { FadeIn, Reveal } from "./motion";
import { useGutter } from "./page";
import { useContainerWidth, useDesktopShell } from "./shellLayout";
import { Skeleton } from "./skeletons";
import { gradientBackground, linearGradient } from "./uiTheme";
import type { ArtworkSource } from "@/domain/artwork";
import { useT } from "@/i18n";
import { withAlpha } from "@/theme/contrast";
import { useTheme } from "@/theme/provider";

export type HeroKind = "playlist" | "album" | "artist" | "mix" | "radio";

/** Linha do dono: avatar pequeno redondo + nome, por baixo do título. */
export interface HeroOwner {
  name: string;
  avatarUri?: string | null;
  onPress?: () => void;
}

export interface HeroProps {
  kind: HeroKind;
  title: string;
  /** Palavra do tipo ("Playlist", "Sincronizada"); por omissão a do `kind`. */
  subtitle?: string;
  /** Linha de meta (contagens...) em texto ou nós. */
  meta?: React.ReactNode;
  /** Dono da playlist / artista do álbum. */
  owner?: HeroOwner;
  /** Capa quadrada (ou o disco do artista sem foto). */
  image?: ArtworkSource | null;
  /** Foto de ponta a ponta (artista). */
  backdropUri?: string | null;
  /** Capa feita pelo ecrã (capa editável, carimbo da mix...): recebe o lado. */
  artworkSlot?: (size: number) => React.ReactNode;
  /** Mantido por compatibilidade; já não pinta nada. */
  accentColor?: string;
  /** Mantido por compatibilidade; já não pinta nada. */
  accentKey?: string;
  style?: StyleProp<ViewStyle>;
}

/** Cantos da capa grande: discretos, como uma capa de disco. */
export const HERO_ART_RADIUS = 8;

/** Espaço que a seta de voltar (BackAffordance) ocupa por cima do hero. */
const BACK_ROOM = 48;

/**
 * Lado da capa no telemóvel: a largura da página menos as margens, sem
 * passar de metade da altura do ecrã (um telefone baixo continua a mostrar
 * as primeiras músicas) nem de 460 (um tablet não a faz cartaz).
 */
export const heroArtSizePhone = (width: number, height: number, gutter: number): number =>
  Math.round(Math.max(180, Math.min(width - gutter * 2, height * 0.5, 460)));

/**
 * Título no telemóvel: 34 quando cabe numa linha; senão o maior degrau que
 * cabe em duas.
 */
export const phoneTitleSize = (textWidth: number, length: number): number => {
  const glyphs = 0.56 * Math.max(length, 1);
  const oneLine = textWidth / glyphs;
  if (oneLine >= 34) return 34;
  const twoLines = (textWidth * 2) / glyphs;
  const steps = [34, 32, 30, 28, 26, 24] as const;
  return steps.find((s) => s <= twoLines) ?? 22;
};

const OwnerRow = ({ owner, color }: { owner: HeroOwner; color: string }) => (
  <Pressable
    onPress={owner.onPress}
    disabled={!owner.onPress}
    accessibilityRole={owner.onPress ? "link" : undefined}
    hitSlop={8}
    style={({ pressed }) => ({
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      alignSelf: "flex-start",
      opacity: pressed ? 0.6 : 1,
    })}
  >
    {owner.avatarUri ? (
      <ArtworkImage uri={owner.avatarUri} size={22} shape="circle" />
    ) : (
      <InitialsAvatar name={owner.name} size={22} />
    )}
    <Text style={{ color, fontSize: 15, fontWeight: "600" }} numberOfLines={1}>
      {owner.name}
    </Text>
  </Pressable>
);

const MetaLine = ({
  kindLine,
  meta,
  color,
  size,
}: {
  kindLine: string;
  meta?: React.ReactNode;
  color: string;
  size: number;
}) => (
  <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 6 }}>
    <Text style={{ color, fontSize: size }}>
      {kindLine}
      {typeof meta === "string" && meta ? ` · ${meta.replace(/ • /g, " · ")}` : ""}
    </Text>
    {meta && typeof meta !== "string" ? meta : null}
  </View>
);

export const Hero = ({
  kind,
  title,
  subtitle,
  meta,
  owner,
  image,
  backdropUri,
  artworkSlot,
  style,
}: HeroProps) => {
  const { tokens } = useTheme();
  const t = useT();
  const { height, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const desktopShell = useDesktopShell();
  const containerWidth = useContainerWidth();
  const gutter = useGutter();

  const kindLine = subtitle ?? t(`components.music.Hero.${kind}`);
  const isArtistBackdrop = kind === "artist" && !!backdropUri;
  const artistAvatar = kind === "artist" && !backdropUri;
  const muted = tokens.mutedForeground;

  // -------------------------------------------------------------------------
  // Artista com foto: a foto de ponta a ponta e o nome por cima.
  // -------------------------------------------------------------------------
  if (isArtistBackdrop && backdropUri) {
    const photoHeight = desktopShell
      ? heroMinHeight(containerWidth, true)
      : Math.round(Math.min(width * 1.05, height * 0.58)) + insets.top;
    const titleSize = desktopShell
      ? heroTitleType(containerWidth, title.length).fontSize
      : Math.min(44, phoneTitleSize(width - gutter * 2, title.length) + 8);
    return (
      <View style={[{ height: photoHeight, justifyContent: "flex-end", overflow: "hidden" }, style]}>
        <FadeIn duration={320} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
          <Image
            source={{ uri: backdropUri }}
            contentFit="cover"
            transition={180}
            style={{ width: "100%", height: "100%" }}
            accessible={false}
          />
        </FadeIn>
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
                `${tokens.background} 0%`,
                `${withAlpha(tokens.background, 0.75)} 22%`,
                "transparent 60%",
              ),
            ),
          }}
        />
        <Reveal style={{ paddingHorizontal: gutter, paddingBottom: 8, gap: 6 }}>
          <Text
            accessibilityRole="header"
            numberOfLines={2}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
            style={{
              color: tokens.foreground,
              fontSize: titleSize,
              lineHeight: Math.round(titleSize * 1.06),
              fontWeight: "800",
              letterSpacing: -1,
            }}
          >
            {title}
          </Text>
          {meta ? <MetaLine kindLine={kindLine} meta={meta} color={muted} size={14} /> : null}
        </Reveal>
      </View>
    );
  }

  // -------------------------------------------------------------------------
  // Computador: capa à esquerda, texto ao lado.
  // -------------------------------------------------------------------------
  if (desktopShell) {
    const size = Math.round(Math.min(232, Math.max(168, containerWidth * 0.18)));
    const titleType = heroTitleType(containerWidth, title.length);
    const art = artistAvatar ? (
      image && image.kind !== "initials" ? (
        <ArtworkImage source={image} size={size} shape="circle" />
      ) : (
        <InitialsAvatar name={title} size={size} />
      )
    ) : artworkSlot ? (
      <View style={{ width: size, height: size }}>{artworkSlot(size)}</View>
    ) : image ? (
      <ArtworkImage source={image} size={size} borderRadius={HERO_ART_RADIUS} />
    ) : null;
    return (
      <View
        style={[
          {
            flexDirection: "row",
            alignItems: "flex-end",
            gap: 28,
            paddingHorizontal: gutter,
            paddingTop: 40,
            paddingBottom: 8,
          },
          style,
        ]}
      >
        {art ? <FadeIn duration={260}>{art}</FadeIn> : null}
        <Reveal style={{ flex: 1, minWidth: 0, gap: 10 }}>
          <Text
            accessibilityRole="header"
            numberOfLines={2}
            style={{
              color: tokens.foreground,
              fontSize: titleType.fontSize,
              lineHeight: titleType.lineHeight,
              fontWeight: "800",
              letterSpacing: titleType.fontSize >= 56 ? -2 : -1,
            }}
          >
            {title}
          </Text>
          {owner ? <OwnerRow owner={owner} color={tokens.foreground} /> : null}
          <MetaLine kindLine={kindLine} meta={meta} color={muted} size={14} />
        </Reveal>
      </View>
    );
  }

  // -------------------------------------------------------------------------
  // Telemóvel: capa grande em cima, texto por baixo encostado à esquerda.
  // -------------------------------------------------------------------------
  const size = artistAvatar
    ? Math.round(Math.min(200, width * 0.48))
    : heroArtSizePhone(width, height, gutter);
  const titleSize = phoneTitleSize(width - gutter * 2, title.length);
  const art = artistAvatar ? (
    image && image.kind !== "initials" ? (
      <ArtworkImage source={image} size={size} shape="circle" />
    ) : (
      <InitialsAvatar name={title} size={size} />
    )
  ) : artworkSlot ? (
    <View style={{ width: size, height: size }}>{artworkSlot(size)}</View>
  ) : image ? (
    <ArtworkImage source={image} size={size} borderRadius={HERO_ART_RADIUS} />
  ) : null;

  return (
    <View
      style={[
        { paddingHorizontal: gutter, paddingTop: insets.top + BACK_ROOM, paddingBottom: 4, gap: 18 },
        style,
      ]}
    >
      {art ? (
        <FadeIn duration={260} style={{ alignItems: artistAvatar ? "flex-start" : "center" }}>
          {art}
        </FadeIn>
      ) : null}
      <Reveal order={1} style={{ gap: 8 }}>
        <Text
          accessibilityRole="header"
          numberOfLines={2}
          style={{
            color: tokens.foreground,
            fontSize: titleSize,
            lineHeight: Math.round(titleSize * 1.1),
            fontWeight: "800",
            letterSpacing: -0.8,
          }}
        >
          {title}
        </Text>
        {owner ? <OwnerRow owner={owner} color={muted} /> : null}
        <MetaLine kindLine={kindLine} meta={meta} color={muted} size={14} />
      </Reveal>
    </View>
  );
};

/**
 * O esqueleto do Hero com a MESMA geometria (capa grande, título, meta):
 * quando o hero verdadeiro monta, nada salta.
 */
export const HeroPlaceholder = ({ kind = "playlist" }: { kind?: HeroKind }) => {
  const { height, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const desktopShell = useDesktopShell();
  const containerWidth = useContainerWidth();
  const gutter = useGutter();
  if (kind === "artist") {
    const photoHeight = desktopShell
      ? heroMinHeight(containerWidth, true)
      : Math.round(Math.min(width * 1.05, height * 0.58)) + insets.top;
    return (
      <View style={{ height: photoHeight, justifyContent: "flex-end", paddingHorizontal: gutter, gap: 10, paddingBottom: 8 }}>
        <Skeleton width="60%" height={36} />
        <Skeleton width="40%" height={14} />
      </View>
    );
  }
  if (desktopShell) {
    const size = Math.round(Math.min(232, Math.max(168, containerWidth * 0.18)));
    return (
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 28, paddingHorizontal: gutter, paddingTop: 40, paddingBottom: 8 }}>
        <Skeleton width={size} height={size} borderRadius={HERO_ART_RADIUS} />
        <View style={{ flex: 1, gap: 12 }}>
          <Skeleton width="55%" height={56} />
          <Skeleton width="30%" height={14} />
        </View>
      </View>
    );
  }
  const size = heroArtSizePhone(width, height, gutter);
  return (
    <View style={{ paddingHorizontal: gutter, paddingTop: insets.top + BACK_ROOM, paddingBottom: 4, gap: 18 }}>
      <View style={{ alignItems: "center" }}>
        <Skeleton width={size} height={size} borderRadius={HERO_ART_RADIUS} />
      </View>
      <View style={{ gap: 10 }}>
        <Skeleton width="65%" height={30} />
        <Skeleton width="35%" height={14} />
        <Skeleton width="50%" height={14} />
      </View>
    </View>
  );
};
