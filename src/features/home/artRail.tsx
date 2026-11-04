/**
 * Capas grandes com o título por baixo (redesenho 2026-11-04): o cartão, a
 * fila horizontal e a grelha que o Início e a Pesquisa usam. Sem caixas nem
 * sombras: a capa é o cartão. Margem sempre `useGutter()`, título de secção
 * sempre `SectionLabel`.
 *
 * As filas recebem listas curtas (no máximo 20, o limite dos pedidos), por
 * isso um ScrollView chega; no computador a roda do rato passa a deslocar na
 * horizontal (react-native-web não passa o onWheel, daí o addEventListener).
 */
import React, { memo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { ArtworkSource } from "@/domain/artwork";
import { useTheme } from "@/theme/provider";
import { ArtworkImage, Icon, Skeleton, collectionGridColumns, useContainerWidth, useDesktopShell } from "@/ui";
import { PressableScale, Reveal } from "@/ui/motion";
import { SectionLabel, useGutter } from "@/ui/page";

/** Largura de um cartão numa fila: grande no telemóvel, um pouco mais no computador. */
/**
 * No computador as filas são grelhas de uma linha que enchem a largura: as
 * colunas que cabem com capas de pelo menos 190 px (artistas, em círculo,
 * 120), e a largura exacta de cada uma. No telemóvel, 152 e a fila desliza.
 */
export const useRailColumns = (circle = false): { columns: number; width: number } => {
  const desktop = useDesktopShell();
  const containerWidth = useContainerWidth();
  if (!desktop) return { columns: 0, width: circle ? 120 : 152 };
  const usable = Math.max(320, containerWidth - 2 * 40);
  const min = circle ? 120 : 190;
  const columns = Math.max(3, Math.floor((usable + RAIL_GAP) / (min + RAIL_GAP)));
  return { columns, width: Math.floor((usable - RAIL_GAP * (columns - 1)) / columns) };
};

export const useCardWidth = (circle = false): number => useRailColumns(circle).width;

const RAIL_GAP = 14;

export const ArtCard = memo(function ArtCard({
  title,
  subtitle,
  artwork,
  art,
  circle = false,
  width,
  onPress,
}: {
  title: string;
  subtitle?: string | null;
  artwork?: ArtworkSource | null;
  /** Capa já desenhada (mixes, rádios); substitui `artwork`. */
  art?: React.ReactNode;
  circle?: boolean;
  width: number;
  onPress: () => void;
}) {
  const { tokens } = useTheme();
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      style={{ width, gap: 8 }}
    >
      {art ?? <ArtworkImage source={artwork} size={width} shape={circle ? "circle" : "rounded"} />}
      <View style={{ minWidth: 0, alignItems: circle ? "center" : "flex-start" }}>
        <Text
          numberOfLines={1}
          style={{ color: tokens.foreground, fontSize: 15, lineHeight: 19, fontWeight: "600" }}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} style={{ color: tokens.mutedForeground, fontSize: 13, lineHeight: 17 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </PressableScale>
  );
});

export const ArtCardSkeleton = ({ width, circle = false }: { width: number; circle?: boolean }) => (
  <View style={{ width, gap: 8 }}>
    <Skeleton width={width} height={width} borderRadius={circle ? width / 2 : 8} />
    <Skeleton width={width * 0.7} height={12} />
    <Skeleton width={width * 0.45} height={10} />
  </View>
);

/** Fila horizontal com rótulo de secção. `loading` mostra cartões a brilhar. */
export const ArtRail = ({
  title,
  actionLabel,
  onAction,
  loading = false,
  circle = false,
  children,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  loading?: boolean;
  circle?: boolean;
  children?: React.ReactNode;
}) => {
  const gutter = useGutter();
  const { columns, width } = useRailColumns(circle);
  const desktop = useDesktopShell();
  const { tokens } = useTheme();
  const [page, setPage] = useState(0);
  const [hovered, setHovered] = useState(false);
  const items = React.Children.toArray(children);

  // Computador: nada de faixa a deslizar escondida nem de roda do rato
  // roubada (queixa do dono 2026-11-04: a página andava para o lado). Uma
  // linha que enche a largura e, havendo mais, ‹ › ao passar o rato.
  if (desktop) {
    const pages = Math.max(1, Math.ceil(items.length / columns));
    const current = Math.min(page, pages - 1);
    const shown = loading
      ? Array.from({ length: columns }, (_, i) => <ArtCardSkeleton key={i} width={width} circle={circle} />)
      : items.slice(current * columns, current * columns + columns);
    const arrow = (dir: 1 | -1) => {
      const disabled = dir === -1 ? current === 0 : current >= pages - 1;
      return (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={dir === 1 ? "›" : "‹"}
          disabled={disabled}
          onPress={() => setPage(current + dir)}
          style={({ pressed, hovered: h }: { pressed: boolean; hovered?: boolean }) => ({
            width: 30,
            height: 30,
            borderRadius: 15,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1,
            borderColor: tokens.border,
            backgroundColor: h ? tokens.secondary : "transparent",
            opacity: disabled ? 0.3 : pressed ? 0.6 : 1,
          })}
        >
          <Icon name={dir === 1 ? "chevron-right" : "chevron-left"} size={16} color={tokens.foreground} />
        </Pressable>
      );
    };
    return (
      <View {...({ onPointerEnter: () => setHovered(true), onPointerLeave: () => setHovered(false) } as object)}>
        <View style={{ flexDirection: "row", alignItems: "flex-end" }}>
          <View style={{ flex: 1 }}>
            <SectionLabel title={title} actionLabel={actionLabel} onAction={onAction} />
          </View>
          {pages > 1 ? (
            <View style={{ flexDirection: "row", gap: 6, paddingRight: gutter, paddingBottom: 10, opacity: hovered ? 1 : 0 }}>
              {arrow(-1)}
              {arrow(1)}
            </View>
          ) : null}
        </View>
        <View style={{ flexDirection: "row", gap: RAIL_GAP, paddingHorizontal: gutter }}>{shown}</View>
      </View>
    );
  }

  return (
    <View>
      <SectionLabel title={title} actionLabel={actionLabel} onAction={onAction} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: gutter, gap: RAIL_GAP }}
      >
        {loading
          ? Array.from({ length: 5 }, (_, i) => <ArtCardSkeleton key={i} width={width} circle={circle} />)
          : children}
      </ScrollView>
    </View>
  );
};

/** Grelha de capas (páginas de um só tipo de resultado). */
export const ArtGrid = <T,>({
  items,
  keyOf,
  render,
}: {
  items: T[];
  keyOf: (item: T, index: number) => string;
  render: (item: T, width: number, index: number) => React.ReactNode;
}) => {
  const gutter = useGutter();
  const containerWidth = useContainerWidth();
  const columns = collectionGridColumns(containerWidth);
  const gap = 16;
  const width = Math.floor((containerWidth - gutter * 2 - gap * (columns - 1)) / columns);
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: gap, rowGap: 22, paddingHorizontal: gutter }}>
      {items.map((item, i) => (
        <Reveal key={keyOf(item, i)} order={Math.min(i, 8)} step={30}>
          {render(item, width, i)}
        </Reveal>
      ))}
    </View>
  );
};
