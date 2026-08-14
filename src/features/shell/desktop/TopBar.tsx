/**
 * Desktop topbar (plano-uma-so-app 4.1/4.3): first grid row of the desktop
 * shell. Back/forward drive the BROWSER history - expo-router only exposes
 * back, and on web the address bar and these buttons must agree, so
 * window.history is the single source of truth for both directions. The
 * center is the persistent search field with its Cmd/Ctrl+K typeahead
 * (TopBarSearch); the full search page remains reachable through it.
 *
 * Web-only by construction: only DesktopShell.web.tsx imports this file.
 */
import React from "react";
import { View } from "react-native";
import { useT } from "@/i18n";
import { GhostIconButton } from "@/ui";
import { TopBarSearch } from "./TopBarSearch";

export const DesktopTopBar = () => {
  const t = useT();

  return (
    <View
      style={{
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 8,
      }}
    >
      <GhostIconButton
        icon="chevron-left"
        accessibilityLabel={t("native.desktop.back")}
        onPress={() => window.history.back()}
      />
      <GhostIconButton
        icon="chevron-right"
        accessibilityLabel={t("native.desktop.forward")}
        onPress={() => window.history.forward()}
      />
      <View style={{ flex: 1, alignItems: "center" }}>
        <TopBarSearch />
      </View>
      {/* Mirror of the back/forward cluster's width so the field centers. */}
      <View style={{ width: 88 }} />
    </View>
  );
};
