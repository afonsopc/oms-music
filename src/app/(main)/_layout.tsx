/**
 * (main) stack + overlay host (FR-16): the MiniPlayer pill (or JamBar /
 * controller strip) floats above every screen. Also fires the FR-22
 * service-usage ping on first authed mount.
 */
import React from "react";
import { View } from "react-native";
import { Stack } from "expo-router";
import { OverlayHost } from "@/features/shell/OverlayHost";
import { useServiceUsagePing } from "@/features/shell/useServiceUsagePing";

export const unstable_settings = { initialRouteName: "(tabs)" };

export default function MainLayout() {
  useServiceUsagePing();
  return (
    <View style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false }} />
      <OverlayHost />
    </View>
  );
}
