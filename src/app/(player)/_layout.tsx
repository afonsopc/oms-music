/**
 * (player) group: presented by the root stack as a full-screen modal. The
 * three routes all render the shared swipeable pager (features/shell/
 * PlayerPager) at different initial pages, so switching between them never
 * animates a stack transition.
 */
import React from "react";
import { Stack } from "expo-router";

export const unstable_settings = { initialRouteName: "now-playing" };

export default function PlayerLayout() {
  return <Stack screenOptions={{ headerShown: false, animation: "none" }} />;
}
