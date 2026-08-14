/**
 * The 3 tabs: Home, Search, Library. Downloads lost its tab on 2026-08-14
 * (owner request): the endless song list was dead weight - the library
 * screens already badge what is downloaded, offline mode surfaces the
 * downloaded playlists by itself, and the numbers live in Settings >
 * Transferências (features/downloads/overview).
 */
import React from "react";
import { Tabs } from "expo-router/js-tabs";
import { ShellTabBar } from "@/features/shell/ShellTabBar";
import { TabIcon } from "@/features/shell/TabIcon";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";

export const unstable_settings = { initialRouteName: "home" };

export default function TabsLayout() {
  const t = useT();
  const { tokens } = useTheme();
  return (
    <Tabs
      tabBar={(props) => <ShellTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: tokens.primary,
        tabBarInactiveTintColor: tokens.mutedForeground,
        tabBarStyle: {
          backgroundColor: tokens.background,
          borderTopColor: tokens.border,
        },
        sceneStyle: { backgroundColor: tokens.background },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: t("native.shell.tabHome"),
          tabBarIcon: ({ color }) => <TabIcon name="home" color={color} />,
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: t("native.shell.tabSearch"),
          tabBarIcon: ({ color }) => <TabIcon name="search" color={color} />,
        }}
      />
      <Tabs.Screen
        name="library"
        options={{
          title: t("native.shell.tabLibrary"),
          tabBarIcon: ({ color }) => <TabIcon name="library" color={color} />,
        }}
      />
    </Tabs>
  );
}
