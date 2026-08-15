/**
 * (main) stack. Fires the FR-22 service-usage ping on first authed mount.
 *
 * Continua a ser um <Stack> por causa da `gallery`, a unica rota que ficou
 * IRMA do navegador de tabs (e dev-only e inalcancavel por UI, triplica-la
 * pelas tres tabs so engordava o export estatico).
 *
 * O OverlayHost desceu para dentro de cada tab a 2026-08-15 (as tabs
 * passaram a ser nativas e a altura da barra do sistema so e observavel de
 * dentro do ecra da tab). Aqui ficou o que TEM de ser unico e sobreviver a
 * troca de tab: a gaveta de perfil, que e um Modal.
 *
 * The whole tree sits inside DesktopShell: a pass-through on native and on
 * web below 900px (the mobile shell stays EXACTLY as it was), and the
 * topbar / sidebar / main / right panel / transport grid on desktop web
 * (plano-uma-so-app 4.1). The Stack becomes the shell's main pane.
 */
import React from "react";
import { View } from "react-native";
import { Stack } from "expo-router";
import { DesktopShell } from "@/features/shell/desktop/DesktopShell";
import { useServiceUsagePing } from "@/features/shell/useServiceUsagePing";
import { useTheme } from "@/theme/provider";

export const unstable_settings = { initialRouteName: "(tabs)" };

export default function MainLayout() {
  useServiceUsagePing();
  const { tokens } = useTheme();
  return (
    <DesktopShell>
      <View style={{ flex: 1, backgroundColor: tokens.background }}>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: tokens.background },
          }}
        />
      </View>
    </DesktopShell>
  );
}
