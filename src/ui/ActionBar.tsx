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
import { Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { GhostIconButton, PlayFab } from "./buttons";
import { Icon, iconForHint } from "./icons";
import { Reveal } from "./motion";
import { useGutter } from "./page";
import { BottomSheet } from "./sheets/BottomSheet";
import { useT } from "@/i18n";
import { haptics } from "@/lib/haptics";
import { useTheme } from "@/theme/provider";

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
  /** Rendered right after the download toggle (the "X de Y" while songs arrive). */
  offlineStatus?: React.ReactNode;
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
  offlineStatus,
  isPlayingThisCollection = false,
  playLoading = false,
  menuItems,
  secondarySlot,
  style,
}: ActionBarProps) => {
  const { tokens, ink } = useTheme();
  const t = useT();
  const gutter = useGutter();
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
            gap: 6,
            paddingHorizontal: gutter,
            paddingTop: 14,
            paddingBottom: 12,
          },
          style,
        ]}
      >
        {onPlay ? (
          <PlayFab
            playing={isPlayingThisCollection}
            loading={playLoading}
            onPress={() => {
              haptics.tap();
              onPlay();
            }}
            size={56}
            style={{ marginRight: 8 }}
            accessibilityLabel={
              isPlayingThisCollection
                ? t("components.music.ActionBar.pause")
                : t("components.music.ActionBar.play")
            }
          />
        ) : null}
        {onShuffle ? (
          <GhostIconButton
            icon="shuffle"
            size={24}
            onPress={() => {
              haptics.tap();
              onShuffle();
            }}
            accessibilityLabel={t("components.music.ActionBar.shuffle")}
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
        {onToggleOffline ? offlineStatus : null}
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
        <View style={{ flex: 1 }} />
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
