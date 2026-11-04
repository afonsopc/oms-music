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
import React, { memo, useEffect, useRef } from "react";
import { Platform, ScrollView, Text, View } from "react-native";
import type { ArtworkSource } from "@/domain/artwork";
import { useTheme } from "@/theme/provider";
import { ArtworkImage, Skeleton, collectionGridColumns, useContainerWidth, useDesktopShell } from "@/ui";
import { PressableScale, Reveal } from "@/ui/motion";
import { SectionLabel, useGutter } from "@/ui/page";

/** Largura de um cartão numa fila: grande no telemóvel, um pouco mais no computador. */
export const useCardWidth = (): number => (useDesktopShell() ? 184 : 152);

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
  const width = useCardWidth();
  const desktop = useDesktopShell();
  const ref = useRef<ScrollView>(null);

  useEffect(() => {
    if (!desktop || Platform.OS !== "web") return;
    const node = ref.current?.getScrollableNode?.() as
      | {
          addEventListener: HTMLElement["addEventListener"];
          removeEventListener: HTMLElement["removeEventListener"];
          scrollLeft: number;
        }
      | null
      | undefined;
    if (!node?.addEventListener) return;
    const onWheel = (event: WheelEvent): void => {
      if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      node.scrollLeft += event.deltaY;
      event.preventDefault();
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [desktop]);

  return (
    <View>
      <SectionLabel title={title} actionLabel={actionLabel} onAction={onAction} />
      <ScrollView
        ref={ref}
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
