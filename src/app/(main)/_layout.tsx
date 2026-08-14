/**
 * (main) stack + overlay host (FR-16): the MiniPlayer pill (or JamBar /
 * controller strip) floats above every screen. Also fires the FR-22
 * service-usage ping on first authed mount.
 *
 * The whole tree sits inside DesktopShell: a pass-through on native and on
 * web below 900px (the mobile shell stays EXACTLY as it was), and the
 * topbar / sidebar / main / right panel / transport grid on desktop web
 * (plano-uma-so-app 4.1). The Stack and the OverlayHost become the shell's
 * main pane; the pill hides itself there because the transport bar is a
 * grid row.
 */
import React from "react";
import { View } from "react-native";
import { Stack } from "expo-router";
import { DesktopShell } from "@/features/shell/desktop/DesktopShell";
import { OverlayHost } from "@/features/shell/OverlayHost";
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
        <OverlayHost />
      </View>
    </DesktopShell>
  );
}
