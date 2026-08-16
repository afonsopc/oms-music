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
import { BackAffordance } from "@/features/shell/BackAffordance";
import { OverlayHost } from "@/features/shell/OverlayHost";
import { useTheme } from "@/theme/provider";

/**
 * A raiz de CADA copia deste layout, dita explicitamente.
 *
 * As chaves sao o nome do grupo SEM parenteses: o getRoutesCore deriva-as
 * com matchLastGroupName, que devolve "library" e nao "(library)". Com
 * parenteses a definicao existe e e ignorada em silencio, que foi como as
 * Gostadas continuaram a aparecer na Pesquisa e na Biblioteca depois da
 * primeira tentativa (2026-08-16).
 *
 * O router tambem descobre a raiz sozinho - procura o FILHO cuja rota tem o
 * nome do grupo - mas so olha para os filhos DESTE layout. Por isso as tres
 * raizes vivem aqui dentro (home.tsx, search.tsx, library.tsx) e nao em
 * pastas (home)/ (search)/ (library) proprias, como estiveram ate agora: la
 * fora nao eram filhas de layout nenhum e cada tab caia na primeira rota da
 * arvore. Esta declaracao e o cinto, a arrumacao dos ficheiros sao os
 * suspensorios.
 */
export const unstable_settings = {
  home: { anchor: "home" },
  search: { anchor: "search" },
  library: { anchor: "library" },
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
      {/* Acima da Stack, abaixo do OverlayHost: a seta flutua sobre o ecra
          empurrado mas nunca sobre a pill nem sobre a JamBar. */}
      <BackAffordance />
      <OverlayHost />
    </View>
  );
}
