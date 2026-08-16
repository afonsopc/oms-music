/**
 * Loading skeletons: a pulsing base block plus the shapes the screens use
 * (tile squares, circular artist discs, song rows, hero header).
 */
import React, { useEffect, useState } from "react";
import { Animated, useWindowDimensions, View, type StyleProp, type ViewStyle } from "react-native";
import { heroArtSizeMobile } from "../breakpoints";
import { useDesktopShell } from "../shellLayout";
import { SONG_ROW_HEIGHT } from "../SongRow";
import { TILE_WIDTH } from "../Tile";
import { useTheme } from "@/theme/provider";
import { RADIUS } from "@/theme/tokens";

export interface SkeletonProps {
  width?: number | `${number}%`;
  height?: number;
  borderRadius?: number;
  circle?: boolean;
  style?: StyleProp<ViewStyle>;
}

export const Skeleton = ({
  width = "100%",
  height = 16,
  borderRadius = RADIUS,
  circle = false,
  style,
}: SkeletonProps) => {
  const { tokens } = useTheme();
  const [pulse] = useState(() => new Animated.Value(0.5));

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const resolvedHeight = circle && typeof width === "number" ? width : height;

  return (
    <Animated.View
      style={[
        {
          width,
          height: resolvedHeight,
          borderRadius: circle && typeof width === "number" ? width / 2 : borderRadius,
          backgroundColor: tokens.muted,
          opacity: pulse,
        },
        style,
      ]}
    />
  );
};

export const CircleSkeleton = ({ size }: { size: number }) => (
  <Skeleton width={size} circle />
);

export const TileSkeleton = ({ width = TILE_WIDTH }: { width?: number }) => (
  <View style={{ width, padding: 12, gap: 12 }}>
    <Skeleton width={width - 24} height={width - 24} />
    <Skeleton width={width - 48} height={12} />
    <Skeleton width={width - 80} height={10} />
  </View>
);

export const SongRowSkeleton = () => (
  <View
    style={{
      height: SONG_ROW_HEIGHT,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 12,
    }}
  >
    <Skeleton width={28} height={12} />
    <Skeleton width={40} height={40} />
    <View style={{ flex: 1, gap: 6 }}>
      <Skeleton width="60%" height={12} />
      <Skeleton width="35%" height={10} />
    </View>
    <Skeleton width={40} height={12} />
  </View>
);

export const SongTableSkeleton = ({ rows = 8 }: { rows?: number }) => (
  <View>
    {Array.from({ length: rows }, (_, i) => (
      <SongRowSkeleton key={i} />
    ))}
  </View>
);

export const HeroSkeleton = ({ artist = false }: { artist?: boolean }) => {
  const { height, width } = useWindowDimensions();
  const desktopShell = useDesktopShell();
  // Mesma geometria do Hero real (ponto 16): capa de coleccao grande e
  // centrada no mobile; no desktop e no disco do artista, o tamanho antigo
  // a esquerda - senao o esqueleto "salta" quando o hero verdadeiro monta.
  const collectionCover = !artist && !desktopShell;
  const art = collectionCover ? heroArtSizeMobile(width) : artist ? 136 : 176;
  return (
    <View
      style={{
        minHeight: Math.round(height * (artist ? 0.42 : 0.36)),
        justifyContent: "flex-end",
        paddingHorizontal: 24,
        paddingBottom: 16,
        gap: 16,
      }}
    >
      <View style={{ alignItems: collectionCover ? "center" : "flex-start" }}>
        <Skeleton width={art} height={art} circle={artist} borderRadius={RADIUS + 4} />
      </View>
      <View style={{ gap: 8 }}>
        <Skeleton width={80} height={10} />
        <Skeleton width={240} height={28} />
        <Skeleton width={160} height={12} />
      </View>
    </View>
  );
};
