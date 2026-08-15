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
import { avatarUrl } from "@/api/mediaUrl";
import { useSessionStore } from "@/auth/session";
import { ShellTabBar } from "@/features/shell/ShellTabBar";
import { TabIcon } from "@/features/shell/TabIcon";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import { ArtworkImage, Icon } from "@/ui";

export const unstable_settings = { anchor: "(home)" };

export default function TabsLayoutWeb() {
  const t = useT();
  const { tokens } = useTheme();
  const userId = useSessionStore((s) => s.user?.id ?? s.session?.user_id ?? null);
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
      {/* O Perfil e uma tab como as outras desde que virou pagina
          (2026-08-15). A barra da web mostrava tres itens porque este nao
          tinha rota; agora tem. O icone e a foto, redonda - aqui e uma View
          normal e a mascara funciona (na barra NATIVA nao ha mascara). */}
      <Tabs.Screen
        name="(account)"
        options={{
          title: t("native.shell.tabProfile"),
          tabBarIcon: ({ color }) =>
            userId ? (
              <ArtworkImage uri={avatarUrl(userId)} size={24} shape="circle" />
            ) : (
              <Icon name="user" size={22} color={String(color)} />
            ),
        }}
      />
    </Tabs>
  );
}
