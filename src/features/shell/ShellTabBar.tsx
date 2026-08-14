/**
 * Default bottom tab bar wrapped in a measuring View: the real rendered
 * height feeds metrics.ts so the overlay host can float the MiniPlayer pill
 * exactly above the bar without hardcoding platform heights.
 *
 * In the DESKTOP shell (web, >= 900px of window) the bar does not render at
 * all: the sidebar owns navigation there. On NATIVE it does not render
 * either: the GlobalTabBar (mounted at (main)/_layout) is THE bar, visible
 * across tabs and pushes alike (Apple Music idiom, owner request
 * 2026-08-14), and it owns the measured-height feed there. Only the mobile
 * WEB shell below 900px keeps this classic in-navigator bar.
 */
import React from "react";
import { Platform, View } from "react-native";
import { BottomTabBar, type BottomTabBarProps } from "expo-router/js-tabs";
import { useDesktopShell } from "@/ui/shellLayout";
import { setMeasuredTabBarHeight } from "./metrics";

export const ShellTabBar = (props: BottomTabBarProps) => {
  const desktop = useDesktopShell();
  if (desktop) return null;
  // NATIVO: a barra do navegador de tabs abdica - a GlobalTabBar (montada
  // no (main)/_layout) e A barra, visivel tambem nos pushes (Apple Music
  // idiom, pedido do dono 2026-08-14). A web abaixo de 900px mantem a barra
  // classica congelada.
  if (Platform.OS !== "web") return null;
  return (
    <View
      onLayout={(event) => setMeasuredTabBarHeight(Math.round(event.nativeEvent.layout.height))}
      style={{ flexDirection: "row", alignItems: "stretch" }}
    >
      <View style={{ flex: 1 }}>
        <BottomTabBar {...props} />
      </View>
    </View>
  );
};
