/**
 * A forma de página comum (redesenho 2026-11-04), a mesma ideia do
 * omelhorsite.pt (`components/ui/page.tsx` de lá): UMA margem lateral, UM
 * título, rótulos de secção pequenos e cinzentos, listas de linhas finas sem
 * caixas, e estados de carregar/vazio/erro iguais em todo o lado.
 *
 *   [avatar] Título da página            (acção)
 *   Secção
 *   ───────────────────────────────────────────
 *   Linha                                     ›
 *   meta
 *   ───────────────────────────────────────────
 *
 * Nada de cartões dentro de cartões nem pílulas: uma caixa só quando um
 * bloco precisa mesmo de moldura (um formulário).
 */
import React, { useEffect, useState } from "react";
import { Pressable, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import { Icon, type IconName } from "./icons";
import { Reveal } from "./motion";
import { waitPhraseKey } from "./motionMath";
import { useDesktopShell } from "./shellLayout";
import { Skeleton } from "./skeletons";

/** Margem lateral: 20 no telemóvel, 40 no computador. */
export const GUTTER = 20;
export const GUTTER_DESKTOP = 40;

export const useGutter = (): number => (useDesktopShell() ? GUTTER_DESKTOP : GUTTER);

/** Escala de texto da página (a mesma em todos os ecrãs): títulos em negrito, sem serifa. */
export const pageType = {
  title: { fontSize: 30, lineHeight: 36, fontWeight: "700", letterSpacing: -0.6 } as TextStyle,
  section: { fontSize: 21, lineHeight: 26, fontWeight: "700", letterSpacing: -0.3 } as TextStyle,
  label: { fontSize: 13, lineHeight: 16, fontWeight: "600", letterSpacing: 0.1 } as TextStyle,
  body: { fontSize: 16, lineHeight: 21 } as TextStyle,
  meta: { fontSize: 14, lineHeight: 18 } as TextStyle,
};

export const PageTitle = ({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
}) => {
  const { tokens } = useTheme();
  const desktop = useDesktopShell();
  return (
    <Text
      accessibilityRole="header"
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.75}
      style={[
        pageType.title,
        desktop ? { fontSize: 34, lineHeight: 40, letterSpacing: -0.7 } : null,
        { color: tokens.foreground, flexShrink: 1 },
        style,
      ]}
    >
      {children}
    </Text>
  );
};

/**
 * O cabeçalho de uma página: o que vai à esquerda (avatar nas tabs), o
 * título, e no máximo UMA acção à direita.
 */
export const PageHeader = ({
  title,
  leading,
  trailing,
  style,
}: {
  title: string;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) => {
  const gutter = useGutter();
  return (
    <View
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingHorizontal: gutter,
          minHeight: 44,
        },
        style,
      ]}
    >
      {leading}
      <View style={{ flex: 1, minWidth: 0 }}>
        <PageTitle>{title}</PageTitle>
      </View>
      {trailing}
    </View>
  );
};

/** Título de secção em negrito, com "Ver tudo" (no destaque) à direita quando há destino. */
export const SectionLabel = ({
  title,
  actionLabel,
  onAction,
  style,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}) => {
  const { tokens } = useTheme();
  const gutter = useGutter();
  const desktop = useDesktopShell();
  return (
    <View
      style={[
        {
          flexDirection: "row",
          alignItems: "flex-end",
          paddingHorizontal: gutter,
          paddingTop: 28,
          paddingBottom: 10,
        },
        style,
      ]}
    >
      <Text
        style={[
          pageType.section,
          desktop ? { fontSize: 24, lineHeight: 30 } : null,
          { color: tokens.foreground, flex: 1 },
        ]}
        numberOfLines={1}
      >
        {title}
      </Text>
      {actionLabel && onAction ? (
        <Pressable accessibilityRole="button" onPress={onAction} hitSlop={10}>
          {({ pressed }) => (
            <Text
              style={{ color: tokens.mutedForeground, fontSize: 14, fontWeight: "500", opacity: pressed ? 0.6 : 1 }}
            >
              {actionLabel}
            </Text>
          )}
        </Pressable>
      ) : null}
    </View>
  );
};

/**
 * Uma linha de lista: 56 px no mínimo, sem caixa, traço fino por baixo. O
 * toque acende o fundo no próprio frame.
 */
export const ListRow = ({
  title,
  meta,
  leading,
  icon,
  trailing,
  chevron,
  destructive,
  disabled,
  onPress,
  onLongPress,
  order,
  last,
  accessibilityLabel,
}: {
  title: string;
  meta?: string | null;
  leading?: React.ReactNode;
  icon?: IconName;
  trailing?: React.ReactNode;
  chevron?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  /** Ordem na cascata de entrada (omitir: sem animação). */
  order?: number;
  last?: boolean;
  accessibilityLabel?: string;
}) => {
  const { tokens, ink } = useTheme();
  const gutter = useGutter();
  const color = destructive ? ink.destructive : tokens.foreground;
  // A acção da direita (`trailing`) fica FORA do Pressable da linha: na web
  // um botão dentro de outro botão é HTML inválido e o toque ia para os dois.
  const row = (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        disabled={disabled || (!onPress && !onLongPress)}
        accessibilityRole={onPress ? "button" : undefined}
        accessibilityLabel={accessibilityLabel ?? title}
        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
          flex: 1,
          minWidth: 0,
          flexDirection: "row",
          alignItems: "center",
          gap: 14,
          minHeight: 56,
          paddingVertical: 10,
          paddingLeft: gutter,
          paddingRight: trailing ? 8 : gutter,
          backgroundColor: pressed ? tokens.secondary : hovered ? tokens.accent : "transparent",
          opacity: disabled ? 0.45 : 1,
        })}
      >
        {leading ??
          (icon ? (
            <Icon name={icon} size={20} color={destructive ? color : tokens.mutedForeground} />
          ) : null)}
        <View style={{ flex: 1, minWidth: 0, alignSelf: "stretch", justifyContent: "center" }}>
          <Text numberOfLines={1} style={[pageType.body, { color, fontWeight: "500" }]}>
            {title}
          </Text>
          {meta ? (
            <Text
              numberOfLines={2}
              style={[pageType.meta, { color: tokens.mutedForeground, marginTop: 2 }]}
            >
              {meta}
            </Text>
          ) : null}
        </View>
        {chevron && !trailing ? (
          <Icon name="chevron-right" size={18} color={tokens.mutedForeground} />
        ) : null}
      </Pressable>
      {trailing ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingRight: gutter }}>
          {trailing}
          {chevron ? <Icon name="chevron-right" size={18} color={tokens.mutedForeground} /> : null}
        </View>
      ) : null}
    </View>
  );
  const body = (
    <View>
      {row}
      {last ? null : (
        <View style={{ height: 1, marginLeft: gutter, backgroundColor: tokens.border }} />
      )}
    </View>
  );
  return order == null ? body : <Reveal order={order}>{body}</Reveal>;
};

/**
 * Debaixo de qualquer espera: nada no primeiro segundo e meio, depois uma
 * frase que muda (2 s, 6 s, 12 s) e, aos 20 s, "Tentar de novo". Uma espera
 * nunca fica parada sem explicação.
 */
export const WaitHint = ({
  active,
  onRetry,
  style,
}: {
  active: boolean;
  onRetry?: () => void;
  style?: StyleProp<ViewStyle>;
}) => {
  const { tokens } = useTheme();
  const t = useT();
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active) return;
    const started = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - started), 500);
    return () => {
      clearInterval(id);
      setElapsed(0);
    };
  }, [active]);
  const phrase = waitPhraseKey(active ? elapsed : 0);
  if (!phrase) return null;
  return (
    <View style={[{ alignItems: "center", gap: 10, paddingVertical: 16 }, style]}>
      <Reveal key={phrase} distance={6} duration={220}>
        <Text style={[pageType.meta, { color: tokens.mutedForeground, textAlign: "center" }]}>
          {t(`native.common.${phrase}`)}
        </Text>
      </Reveal>
      {phrase === "waitStuck" && onRetry ? <TextButton label={t("native.common.tryAgain")} onPress={onRetry} /> : null}
    </View>
  );
};

/** Botão de texto com contorno fino (acções secundárias, tentar de novo). */
export const TextButton = ({
  label,
  onPress,
  icon,
  style,
}: {
  label: string;
  onPress: () => void;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
}) => {
  const { tokens } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        {
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          minHeight: 40,
          paddingHorizontal: 18,
          borderRadius: 20,
          borderWidth: 1,
          borderColor: tokens.muted,
          backgroundColor: pressed ? tokens.secondary : "transparent",
          transform: [{ scale: pressed ? 0.97 : 1 }],
        },
        style,
      ]}
    >
      {icon ? <Icon name={icon} size={16} color={tokens.foreground} /> : null}
      <Text style={{ color: tokens.foreground, fontSize: 14, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
};

/** Esqueleto de uma lista de linhas (capa + duas linhas de texto). */
export const ListSkeleton = ({
  rows = 8,
  artwork = true,
  round = false,
}: {
  rows?: number;
  artwork?: boolean;
  round?: boolean;
}) => {
  const gutter = useGutter();
  return (
    <View accessibilityLabel="…" style={{ paddingHorizontal: gutter, gap: 4 }}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 14, height: 56 }}>
          {artwork ? <Skeleton width={44} height={44} borderRadius={round ? 22 : 6} /> : null}
          <View style={{ flex: 1, gap: 8 }}>
            <Skeleton width={`${70 - ((i * 13) % 30)}%`} height={13} />
            <Skeleton width={`${40 - ((i * 7) % 15)}%`} height={11} />
          </View>
        </View>
      ))}
    </View>
  );
};

/**
 * O estado de uma página que depende de um pedido: esqueleto (com a frase
 * que muda), erro com "Tentar de novo", ou vazio com uma frase e uma acção.
 * Devolve null quando há conteúdo para mostrar.
 */
export const PageState = ({
  loading,
  error,
  empty,
  onRetry,
  emptyIcon = "music",
  emptyText,
  emptyActionLabel,
  onEmptyAction,
  skeleton,
}: {
  loading: boolean;
  error?: unknown;
  empty?: boolean;
  onRetry?: () => void;
  emptyIcon?: IconName;
  emptyText?: string;
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
  skeleton?: React.ReactNode;
}) => {
  const { tokens } = useTheme();
  const t = useT();
  if (loading) {
    return (
      <View>
        {skeleton ?? <ListSkeleton />}
        <WaitHint active onRetry={onRetry} />
      </View>
    );
  }
  if (error) {
    return (
      <Reveal>
        <View style={{ alignItems: "center", gap: 14, paddingVertical: 48, paddingHorizontal: 24 }}>
          <Icon name="alert-circle" size={28} color={tokens.mutedForeground} />
          <Text style={[pageType.body, { color: tokens.foreground, textAlign: "center" }]}>
            {t("native.common.loadFailed")}
          </Text>
          {onRetry ? <TextButton label={t("native.common.tryAgain")} onPress={onRetry} /> : null}
        </View>
      </Reveal>
    );
  }
  if (empty && emptyText) {
    return (
      <Reveal>
        <View style={{ alignItems: "center", gap: 14, paddingVertical: 48, paddingHorizontal: 24 }}>
          <Icon name={emptyIcon} size={28} color={tokens.mutedForeground} />
          <Text style={[pageType.body, { color: tokens.mutedForeground, textAlign: "center" }]}>
            {emptyText}
          </Text>
          {emptyActionLabel && onEmptyAction ? (
            <TextButton label={emptyActionLabel} onPress={onEmptyAction} />
          ) : null}
        </View>
      </Reveal>
    );
  }
  return null;
};
