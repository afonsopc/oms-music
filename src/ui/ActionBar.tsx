/**
 * Control row under the hero, arranged like Spotify's (owner point 16,
 * 2026-08-16): the SMALL secondary actions (like, download, add, radio,
 * overflow...) cluster on the LEFT, and playback - shuffle plus the 56px
 * play FAB - sits LARGE on the RIGHT. Each control renders ONLY when its
 * handler is passed. The overflow menu opens a bottom sheet with
 * caller-provided items.
 */
import React, { useState } from "react";
import { Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { GhostIconButton, PlayFab } from "./buttons";
import { Icon, iconForHint } from "./icons";
import { BottomSheet } from "./sheets/BottomSheet";
import { useT } from "@/i18n";
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
  isPlayingThisCollection?: boolean;
  playLoading?: boolean;
  /** Overflow sheet items (e.g. delete playlist, copy to editable). */
  menuItems?: ActionBarMenuItem[];
  /**
   * Extra SMALL actions, rendered with the secondary cluster on the left
   * (view-mode toggles, artist stories preview...). Was `rightSlot` before
   * the Spotify arrangement moved play/shuffle to the right side.
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
  isPlayingThisCollection = false,
  playLoading = false,
  menuItems,
  secondarySlot,
  style,
}: ActionBarProps) => {
  const { tokens, ink } = useTheme();
  const t = useT();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <View
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          paddingHorizontal: 24,
          paddingTop: 16,
          paddingBottom: 20,
        },
        style,
      ]}
    >
      {/* Cluster secundario, pequeno, a ESQUERDA (ordem a Spotify: gosto,
          download, adicionar, radio, extras, overflow no fim). */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 }}>
        {onLike ? (
          <GhostIconButton
            icon="heart"
            onPress={onLike}
            active={liked}
            filled={liked}
            accessibilityLabel={t("components.music.ActionBar.like")}
          />
        ) : null}
        {onToggleOffline ? (
          <GhostIconButton
            icon={isOffline ? "cloud-check" : "download"}
            onPress={onToggleOffline}
            active={isOffline}
            accessibilityLabel={
              isOffline
                ? t("components.music.ActionBar.offlineOn")
                : t("components.music.ActionBar.offlineOff")
            }
          />
        ) : null}
        {onAdd ? (
          <GhostIconButton
            icon="plus"
            onPress={onAdd}
            accessibilityLabel={addLabel ?? t("components.music.ActionBar.add")}
          />
        ) : null}
        {onStartRadio ? (
          <GhostIconButton
            icon="radio"
            onPress={onStartRadio}
            accessibilityLabel={t("components.music.ActionBar.startRadio")}
          />
        ) : null}
        {secondarySlot}
        {menuItems && menuItems.length > 0 ? (
          <GhostIconButton
            icon="more-horizontal"
            onPress={() => setMenuOpen(true)}
            accessibilityLabel={t("components.music.ActionBar.more")}
          />
        ) : null}
      </View>
      {/* Reproducao GRANDE a DIREITA: shuffle em ghost maior junto ao FAB. */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {onShuffle ? (
          <GhostIconButton
            icon="shuffle"
            size={26}
            onPress={onShuffle}
            accessibilityLabel={t("components.music.ActionBar.shuffle")}
          />
        ) : null}
        {onPlay ? (
          <PlayFab
            playing={isPlayingThisCollection}
            loading={playLoading}
            onPress={onPlay}
            size={56}
            accessibilityLabel={
              isPlayingThisCollection
                ? t("components.music.ActionBar.pause")
                : t("components.music.ActionBar.play")
            }
          />
        ) : null}
      </View>

      {menuItems && menuItems.length > 0 ? (
        <BottomSheet visible={menuOpen} onClose={() => setMenuOpen(false)}>
          {menuItems.map((item) => {
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
                  gap: 14,
                  paddingHorizontal: 20,
                  paddingVertical: 13,
                  opacity: item.disabled ? 0.4 : pressed ? 0.6 : 1,
                })}
              >
                {icon ? (
                  <Icon name={icon} size={19} color={tint} />
                ) : (
                  <View style={{ width: 19 }} />
                )}
                <Text style={{ color: tint, fontSize: 15 }} numberOfLines={1}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </BottomSheet>
      ) : null}
    </View>
  );
};
