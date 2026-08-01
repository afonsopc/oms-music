/** The 4 tabs: Home, Search, Library, Downloads (DESIGN 15.3). */
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
      <Tabs.Screen
        name="downloads"
        options={{
          title: t("native.shell.tabDownloads"),
          tabBarIcon: ({ color }) => <TabIcon name="downloads" color={color} />,
        }}
      />
    </Tabs>
  );
}
