/**
 * Keyboard shortcuts overlay (plano-uma-so-app 4.4: "mapa de atalhos com
 * overlay em Cmd/Ctrl+/"). A centered modal card listing the map that
 * shortcutMap implements - the two must be edited together, which is why
 * the rows below are in the same order as the ShortcutAction union.
 *
 * Escape closes through the Modal's onRequestClose (react-native-web wires
 * it), Cmd/Ctrl+/ closes because the global listener keeps hearing the
 * combo through the open modal and toggles.
 *
 * Web-only by construction: only DesktopShell.web.tsx imports this file.
 */
import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import { GhostIconButton } from "@/ui";
import { modalScrim, heavyShadow } from "@/ui/uiTheme";

export interface ShortcutsOverlayProps {
  visible: boolean;
  onClose: () => void;
}

interface ShortcutRow {
  combo: string;
  labelKey: string;
}

/** Platform-true glyphs: ⌘/⌥ read native on a Mac, Ctrl/Alt elsewhere. */
const buildRows = (mac: boolean): ShortcutRow[] => {
  const mod = mac ? "⌘" : "Ctrl";
  const alt = mac ? "⌥⇧" : "Alt+Shift+";
  const join = mac ? "" : "+";
  return [
    { combo: "Space", labelKey: "native.desktop.shortcutPlayPause" },
    { combo: "← / →", labelKey: "native.desktop.shortcutSeek" },
    { combo: "↑ / ↓", labelKey: "native.desktop.shortcutBareVolume" },
    { combo: `${mod}${join}← / ${mod}${join}→`, labelKey: "native.desktop.shortcutPrevNext" },
    { combo: `${mod}${join}↑ / ${mod}${join}↓`, labelKey: "native.desktop.shortcutVolume" },
    { combo: "M", labelKey: "native.desktop.shortcutMute" },
    { combo: `${mod}${join}K`, labelKey: "native.desktop.shortcutSearch" },
    { combo: `${alt}Q`, labelKey: "native.desktop.tenantQueue" },
    { combo: `${alt}R`, labelKey: "native.desktop.tenantNowPlaying" },
    { combo: `${alt}L`, labelKey: "native.desktop.shortcutSidebar" },
    { combo: `${mod}${join}/`, labelKey: "native.desktop.shortcutOverlay" },
  ];
};

export const ShortcutsOverlay = ({ visible, onClose }: ShortcutsOverlayProps) => {
  const { tokens, scheme } = useTheme();
  const t = useT();

  if (!visible) return null;

  const mac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform ?? "");
  const rows = buildRows(mac);

  return (
    <Modal transparent statusBarTranslucent animationType="fade" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        accessibilityLabel={t("native.common.close")}
        style={[StyleSheet.absoluteFill, { backgroundColor: modalScrim(scheme) }]}
      />
      <View
        pointerEvents="box-none"
        style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
      >
        <View
          style={[
            {
              width: 420,
              maxWidth: "90%",
              borderRadius: 16,
              backgroundColor: tokens.popover,
              borderWidth: 1,
              borderColor: tokens.border,
              paddingBottom: 12,
              overflow: "hidden",
            },
            heavyShadow,
          ]}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingLeft: 20,
              paddingRight: 8,
              paddingVertical: 10,
              borderBottomWidth: 1,
              borderBottomColor: tokens.border,
            }}
          >
            <Text
              style={{ flex: 1, color: tokens.foreground, fontSize: 16, fontWeight: "700" }}
            >
              {t("native.desktop.shortcutsTitle")}
            </Text>
            <GhostIconButton
              icon="x"
              size={16}
              accessibilityLabel={t("native.common.close")}
              onPress={onClose}
            />
          </View>
          {rows.map((row) => (
            <View
              key={row.labelKey}
              style={{
                flexDirection: "row",
                alignItems: "center",
                paddingHorizontal: 20,
                paddingVertical: 8,
                gap: 16,
              }}
            >
              <Text style={{ flex: 1, color: tokens.foreground, fontSize: 14 }}>
                {t(row.labelKey)}
              </Text>
              <Text
                style={{
                  color: tokens.mutedForeground,
                  fontSize: 13,
                  fontVariant: ["tabular-nums"],
                  backgroundColor: tokens.secondary,
                  borderRadius: 6,
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                  overflow: "hidden",
                }}
              >
                {row.combo}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </Modal>
  );
};
