/**
 * A fila de acções por baixo do hero (redesenho 2026-11-04): UMA linha.
 *
 *   (PLAY)  ⤮  ↓  ♡                                   ⋯
 *
 * O play redondo é a acção principal e fica encostado à margem, debaixo do
 * título; baralhar, descarregar e gostar são ícones pequenos ao lado; tudo o
 * resto (adicionar, rádio, os extras do ecrã) vive no menu "⋯", que abre uma
 * folha de baixo. Cada controlo só aparece quando o ecrã passa o handler.
 */
import React, { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { GhostIconButton } from "./buttons";
import { Icon, iconForHint } from "./icons";
import { Reveal } from "./motion";
import { useGutter } from "./page";
import { BottomSheet } from "./sheets/BottomSheet";
import { useT } from "@/i18n";
import { haptics } from "@/lib/haptics";
import { useTheme } from "@/theme/provider";
import { ACCENT, ON_ACCENT } from "@/theme/tokens";
import { useDesktopShell } from "./shellLayout";

export interface ActionBarMenuItem {
  id: string;
  label: string;
  icon?: string;
  destructive?: boolean;
  disabled?: boolean;
  onPress: () => void;
}

export interface ActionBarProps {
  onPlay?: () => void;
  onShuffle?: () => void;
  onStartRadio?: () => void;
  onLike?: () => void;
  liked?: boolean;
  onAdd?: () => void;
  addLabel?: string;
  /** Offline keep-synced toggle (FR-87): Download / CloudCheck states. */
  onToggleOffline?: () => void;
  isOffline?: boolean;
  isPlayingThisCollection?: boolean;
  playLoading?: boolean;
  /** Overflow sheet items (e.g. delete playlist, copy to editable). */
  menuItems?: ActionBarMenuItem[];
  /**
   * Extra SMALL actions, rendered with the secondary cluster on the left
   * (view-mode toggles, artist stories preview...). Was `rightSlot` before
   * the reference-app arrangement moved play/shuffle to the right side.
   */
  secondarySlot?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

const BigButton = ({
  icon,
  label,
  primary = false,
  loading = false,
  desktop,
  onPress,
}: {
  icon: "play" | "pause" | "shuffle";
  label: string;
  primary?: boolean;
  loading?: boolean;
  desktop: boolean;
  onPress: () => void;
}) => {
  const { tokens, scheme } = useTheme();
  const fg = primary ? ON_ACCENT : ACCENT[scheme].ink;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flex: desktop ? undefined : 1,
        minWidth: desktop ? 132 : undefined,
        height: 46,
        paddingHorizontal: 18,
        borderRadius: 10,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        backgroundColor: primary ? ACCENT[scheme].fill : tokens.secondary,
        transform: [{ scale: pressed ? 0.97 : 1 }],
        opacity: pressed ? 0.9 : 1,
      })}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Icon name={icon} size={17} color={fg} filled={icon !== "shuffle"} />}
      <Text style={{ color: fg, fontSize: 16, fontWeight: "600" }} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
};

export const ActionBar = ({
  onPlay,
  onShuffle,
  onStartRadio,
  onLike,
  liked = false,
  onAdd,
  addLabel,
  onToggleOffline,
  isOffline = false,
  isPlayingThisCollection = false,
  playLoading = false,
  menuItems,
  secondarySlot,
  style,
}: ActionBarProps) => {
  const { tokens, ink } = useTheme();
  const t = useT();
  const gutter = useGutter();
  const desktop = useDesktopShell();
  const [menuOpen, setMenuOpen] = useState(false);

  // Adicionar e rádio deixaram de ser ícones soltos: entram no topo do menu.
  const allItems = useMemo<ActionBarMenuItem[]>(() => {
    const items: ActionBarMenuItem[] = [];
    if (onAdd) {
      items.push({
        id: "__add",
        label: addLabel ?? t("components.music.ActionBar.add"),
        icon: "plus",
        onPress: onAdd,
      });
    }
    if (onStartRadio) {
      items.push({
        id: "__radio",
        label: t("components.music.ActionBar.startRadio"),
        icon: "radio",
        onPress: onStartRadio,
      });
    }
    return [...items, ...(menuItems ?? [])];
  }, [onAdd, addLabel, onStartRadio, menuItems, t]);

  return (
    <Reveal order={2}>
      <View
        style={[
          {
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            paddingHorizontal: gutter,
            paddingTop: 16,
            paddingBottom: 14,
          },
          style,
        ]}
      >
        {/* Ronda 2 (idioma Apple Music): dois botões com nome, Tocar no
            destaque e Aleatório no cinzento; o resto são ícones. */}
        {onPlay ? (
          <BigButton
            icon={isPlayingThisCollection ? "pause" : "play"}
            label={isPlayingThisCollection ? t("components.music.ActionBar.pause") : t("components.music.ActionBar.play")}
            loading={playLoading}
            primary
            desktop={desktop}
            onPress={() => {
              haptics.tap();
              onPlay();
            }}
          />
        ) : null}
        {onShuffle ? (
          <BigButton
            icon="shuffle"
            label={t("native.collection.shuffleShort")}
            desktop={desktop}
            onPress={() => {
              haptics.tap();
              onShuffle();
            }}
          />
        ) : null}
        {onToggleOffline ? (
          <GhostIconButton
            icon={isOffline ? "cloud-check" : "download"}
            size={22}
            onPress={() => {
              haptics.select();
              onToggleOffline();
            }}
            active={isOffline}
            accessibilityLabel={
              isOffline
                ? t("components.music.ActionBar.offlineOn")
                : t("components.music.ActionBar.offlineOff")
            }
          />
        ) : null}
        {onLike ? (
          <GhostIconButton
            icon="heart"
            size={22}
            onPress={() => {
              if (!liked) haptics.success();
              onLike();
            }}
            active={liked}
            filled={liked}
            accessibilityLabel={t("components.music.ActionBar.like")}
          />
        ) : null}
        {secondarySlot}
        {desktop ? <View style={{ flex: 1 }} /> : null}
        {allItems.length > 0 ? (
          <GhostIconButton
            icon="more-horizontal"
            size={24}
            onPress={() => {
              haptics.select();
              setMenuOpen(true);
            }}
            accessibilityLabel={t("components.music.ActionBar.more")}
          />
        ) : null}
      </View>

      {allItems.length > 0 ? (
        <BottomSheet visible={menuOpen} onClose={() => setMenuOpen(false)}>
          {allItems.map((item) => {
            const icon = iconForHint(item.icon);
            const tint = item.destructive ? ink.destructive : tokens.foreground;
            return (
              <Pressable
                key={item.id}
                onPress={() => {
                  setMenuOpen(false);
                  item.onPress();
                }}
                disabled={item.disabled}
                accessibilityRole="menuitem"
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 16,
                  minHeight: 52,
                  paddingHorizontal: 20,
                  backgroundColor: pressed ? tokens.secondary : "transparent",
                  opacity: item.disabled ? 0.4 : 1,
                })}
              >
                {icon ? (
                  <Icon name={icon} size={20} color={item.destructive ? tint : tokens.mutedForeground} />
                ) : (
                  <View style={{ width: 20 }} />
                )}
                <Text style={{ color: tint, fontSize: 16 }} numberOfLines={1}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </BottomSheet>
      ) : null}
    </Reveal>
  );
};
