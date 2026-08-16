/**
 * A web fica com as tabs de JS. As nativas ate renderizam no
 * react-native-web (NativeTabsView.web.js usa @radix-ui/react-tabs) mas
 * desenham uma pilula FIXA no topo da janela, sem icones e a todas as
 * larguras: partia o shell desktop acima dos 900px e a barra classica
 * abaixo deles. Este ficheiro e o layout de tabs de sempre, congelado, so
 * com os nomes dos GRUPOS em vez dos nomes dos ecras - a arvore de
 * ficheiros e partilhada entre plataformas e nao pode ser bifurcada por
 * rota, so por layout.
 *
 * A resolucao por plataforma e do proprio expo-router (getFileMeta da
 * specificity 2 ao .web.tsx na web e -1 no nativo), nao do Metro.
 */
import React from "react";
import { Tabs } from "expo-router/js-tabs";
import { ShellTabBar } from "@/features/shell/ShellTabBar";
import { TabIcon } from "@/features/shell/TabIcon";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";

export const unstable_settings = { anchor: "(home)" };

export default function TabsLayoutWeb() {
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
        name="(home)"
        options={{
          title: t("native.shell.tabHome"),
          tabBarIcon: ({ color }) => <TabIcon name="home" color={color} />,
        }}
      />
      <Tabs.Screen
        name="(search)"
        options={{
          title: t("native.shell.tabSearch"),
          tabBarIcon: ({ color }) => <TabIcon name="search" color={color} />,
        }}
      />
      <Tabs.Screen
        name="(library)"
        options={{
          title: t("native.shell.tabLibrary"),
          tabBarIcon: ({ color }) => <TabIcon name="library" color={color} />,
        }}
      />
      <Tabs.Screen
        name="(assistant)"
        options={{
          title: t("native.shell.tabAssistant"),
          tabBarIcon: ({ color }) => <TabIcon name="assistant" color={color} />,
        }}
      />
    </Tabs>
  );
}
