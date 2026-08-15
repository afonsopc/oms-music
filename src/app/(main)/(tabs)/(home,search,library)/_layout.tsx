/**
 * A stack de CADA tab. O expo-router expande o nome do grupo em array e gera
 * tres copias deste layout - (home), (search) e (library) - cada uma com o
 * seu anchor derivado do nome do grupo (o filho cujo `route` iguala o grupo:
 * (home)/home.tsx, (search)/search.tsx, (library)/library.tsx).
 *
 * E isto que mantem a barra do sistema visivel nos ecras empurrados: a
 * playlist, o album, o artista e as definicoes deixaram de ser IRMAOS do
 * navegador de tabs e passaram a viver DENTRO dele, por isso o
 * UITabBarController continua a desenhar a barra por cima deles.
 *
 * O OverlayHost desceu do (main) para aqui porque a altura da barra nativa
 * so e observavel de dentro do ecra da tab (o UITabBarController injecta-a
 * no safe area do view controller filho). Fica montado uma vez por grupo, e
 * so o da tab focada e que esta visivel.
 */
import React from "react";
import { View } from "react-native";
import { Stack } from "expo-router";
import { OverlayHost } from "@/features/shell/OverlayHost";
import { useTheme } from "@/theme/provider";

/**
 * A raiz de CADA copia deste layout, dita explicitamente.
 *
 * Sem isto, so a (home) abria no sitio certo e as outras duas tabs abriam
 * numa rota qualquer da stack - o dono viu as Gostadas na Pesquisa e na
 * Biblioteca (2026-08-16). A leitura ingenua e que o router adivinha a raiz
 * pelo nome do grupo; nao adivinha - o getRoutesCore so aceita a raiz de um
 * grupo partilhado por `unstable_settings[<grupo>].anchor`, e sem ela fica a
 * primeira rota da arvore, que aqui calha ser uma das paginas empurradas.
 */
export const unstable_settings = {
  "(home)": { anchor: "home" },
  "(search)": { anchor: "search" },
  "(library)": { anchor: "library" },
};

export default function TabStackLayout() {
  const { tokens } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: tokens.background }}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: tokens.background },
        }}
      />
      <OverlayHost />
    </View>
  );
}
