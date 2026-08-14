/**
 * Desktop topbar (plano-uma-so-app 4.1/4.3): first grid row of the desktop
 * shell. Back/forward drive the BROWSER history - expo-router only exposes
 * back, and on web the address bar and these buttons must agree, so
 * window.history is the single source of truth for both directions. The
 * center is the persistent search field with its Cmd/Ctrl+K typeahead
 * (TopBarSearch); the right corner holds the account avatar (AccountMenu),
 * Spotify's placement.
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

/** Largura dos semaforos do macOS + folga (overlay title bar). */
const TRAFFIC_LIGHTS_INSET = 72;

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
        paddingLeft: tauri ? TRAFFIC_LIGHTS_INSET : 8,
        paddingRight: 8,
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
      <View style={{ flex: 1, alignItems: "center" }} pointerEvents="box-none">
        <TopBarSearch />
      </View>
      {/* O cluster direito equilibra o esquerdo para o campo centrar. */}
      <View style={{ width: tauri ? 88 : 52, alignItems: "flex-end" }}>
        <AccountMenu />
      </View>
    </View>
  );
};
