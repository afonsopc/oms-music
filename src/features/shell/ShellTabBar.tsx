/**
 * Default bottom tab bar wrapped in a measuring View: the real rendered
 * height feeds metrics.ts so the overlay host can float the MiniPlayer pill
 * exactly above the bar without hardcoding platform heights.
 *
 * In the DESKTOP shell (web, >= 900px of window) the bar does not render at
 * all: the sidebar owns navigation there, and metrics.ts stops consulting
 * the measured height behind the same gate. Below 900px (and on native,
 * always) the bar is exactly what it always was.
 */
import React from "react";
import { View } from "react-native";
import { BottomTabBar, type BottomTabBarProps } from "expo-router/js-tabs";
import { useDesktopShell } from "@/ui/shellLayout";
import { setMeasuredTabBarHeight } from "./metrics";

export const ShellTabBar = (props: BottomTabBarProps) => {
  const desktop = useDesktopShell();
  if (desktop) return null;
  return (
    <View
      onLayout={(event) => setMeasuredTabBarHeight(Math.round(event.nativeEvent.layout.height))}
    >
      <BottomTabBar {...props} />
    </View>
  );
};
