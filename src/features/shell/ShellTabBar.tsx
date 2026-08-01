/**
 * Default bottom tab bar wrapped in a measuring View: the real rendered
 * height feeds metrics.ts so the overlay host can float the MiniPlayer pill
 * exactly above the bar without hardcoding platform heights.
 */
import React from "react";
import { View } from "react-native";
import { BottomTabBar, type BottomTabBarProps } from "expo-router/js-tabs";
import { setMeasuredTabBarHeight } from "./metrics";

export const ShellTabBar = (props: BottomTabBarProps) => (
  <View
    onLayout={(event) => setMeasuredTabBarHeight(Math.round(event.nativeEvent.layout.height))}
  >
    <BottomTabBar {...props} />
  </View>
);
