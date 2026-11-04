/**
 * Desktop topbar (plano-uma-so-app 4.1/4.3): first grid row of the desktop
 * shell. Back/forward drive the BROWSER history - expo-router only exposes
 * back, and on web the address bar and these buttons must agree, so
 * window.history is the single source of truth for both directions. The
 * center is the persistent search field with its Cmd/Ctrl+K typeahead
 * (TopBarSearch); the right corner holds the account avatar (AccountMenu),
 * the reference app's placement.
 *
 * Inside the TAURI shell the window uses the SYSTEM title bar as overlay
 * (titleBarStyle Overlay, feedback do dono): the traffic lights float over
 * this row, so it reserves their width on the left and declares itself the
 * drag region - the topbar IS the title bar there. In a plain browser both
 * behaviors are inert.
 *
 * Web-only by construction: only DesktopShell.web.tsx imports this file.
 */
import React from "react";
import { View } from "react-native";
import { isDesktopShell as isTauriShell } from "@/desktop/tauri";
import { useT } from "@/i18n";
import { GhostIconButton } from "@/ui";
import { AccountMenu } from "./AccountMenu";
import { TopBarSearch } from "./TopBarSearch";

export const DesktopTopBar = () => {
  const t = useT();
  const tauri = isTauriShell();

  return (
    <View
      // A regiao de arrasto da janela no shell Tauri: o atributo aplica-se a
      // ESTE elemento, nunca aos filhos, por isso botoes e campo de pesquisa
      // continuam clicaveis e so o fundo arrasta.
      {...(tauri ? { dataSet: { "tauri-drag-region": "true" } } : null)}
      style={{
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        // Os semáforos do Tauri vivem agora no topo da barra lateral (ronda 2).
        paddingLeft: 30,
        paddingRight: 40,
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
      <View style={{ flex: 1, alignItems: "flex-start", paddingLeft: 12 }} pointerEvents="box-none">
        <TopBarSearch />
      </View>
      <View style={{ width: 52, alignItems: "flex-end" }}>
        <AccountMenu />
      </View>
    </View>
  );
};
