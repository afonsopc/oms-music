/**
 * As tabs NATIVAS do sistema (UITabBar no iOS, BottomNavigationView no
 * Android), pedido do dono a 2026-08-15. Deixaram de ser um capsulo nosso
 * porque o vidro desenhado a mao nunca soube o que tinha por baixo e os
 * rotulos desapareciam sobre as capas; a barra do sistema no iOS 26 JA e
 * Liquid Glass e sabe refractar o conteudo por baixo dela sem ajuda nenhuma.
 *
 * NAO passar backgroundColor nem blurEffect: no expo-router 57.0.9 sao
 * no-op (build/native-tabs/appearance.js devolve {}), e no dia em que
 * deixarem de o ser matam o vidro do sistema, que e exactamente o que se
 * veio aqui buscar.
 *
 * Cada trigger aponta para um GRUPO e nao para um ecra: e o que poe as 21
 * rotas empurradas dentro da stack da respectiva tab e mantem a barra
 * visivel la (ver (home,search,library)/_layout.tsx).
 *
 * So NATIVO. A web tem o fork _layout.web.tsx: as native tabs renderizam
 * la (via @radix-ui/react-tabs) mas desenham uma pilula fixa no TOPO da
 * janela, sem icones, o que partia o shell desktop e a barra classica de
 * baixo dos 900px.
 */
import React from "react";
import { Platform } from "react-native";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { useSessionStore } from "@/auth/session";
import { openProfileDrawer } from "@/features/home/ProfileDrawer";
import { useT } from "@/i18n";
import { useTabAvatarIcon } from "@/features/shell/tabAvatar";
import { useTheme } from "@/theme/provider";

export const unstable_settings = { anchor: "(home)" };

// iOS: o react-native-screens liga por omissao o contentInsetAdjustment do
// primeiro ScrollView de cada ecra. A app ja paga esse espaco em 21 ecras
// atraves do metrics.ts (useContentBottomPadding), por isso a soma
// automatica ficava a dobrar. No Android o mesmo flag controla o
// SafeAreaView que recorta o conteudo acima da barra, e esse queremos.
const OWN_INSETS = Platform.OS === "ios";

export default function TabsLayout() {
  const t = useT();
  const { tokens } = useTheme();
  const userId = useSessionStore((s) => s.user?.id ?? s.session?.user_id ?? null);
  const avatarIcon = useTabAvatarIcon(userId);

  return (
    // minimizeBehavior "never": a pill do mini-player e nossa e flutua num
    // offset derivado do safe area. Com a barra a encolher no scroll (o
    // "automatic" do iOS 26) a pill andava aos saltos. Deixar a barra
    // minimizar exige mudar a pill para NativeTabs.BottomAccessory, que e
    // outro trabalho.
    <NativeTabs tintColor={tokens.primary} minimizeBehavior="never">
      <NativeTabs.Trigger name="(home)" disableAutomaticContentInsets={OWN_INSETS}>
        <NativeTabs.Trigger.Label>{t("native.shell.tabHome")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "house", selected: "house.fill" }} md="home" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="(search)" disableAutomaticContentInsets={OWN_INSETS}>
        <NativeTabs.Trigger.Label>{t("native.shell.tabSearch")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="magnifyingglass" md="search" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="(library)" disableAutomaticContentInsets={OWN_INSETS}>
        <NativeTabs.Trigger.Label>{t("native.shell.tabLibrary")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: "books.vertical", selected: "books.vertical.fill" }}
          md="library_music"
        />
      </NativeTabs.Trigger>

      {/* O "Perfil" abre a gaveta, nao navega. Como a barra nativa so aceita
          rotas, e um trigger `disabled` (o preventNativeSelection do
          react-native-screens: o item fica visivel, o toque emite tabPress e
          o nativo NAO navega) apoiado na rota-fantasma account.tsx. */}
      <NativeTabs.Trigger
        name="account"
        disabled
        listeners={{ tabPress: () => openProfileDrawer() }}
        disableAutomaticContentInsets={OWN_INSETS}
      >
        <NativeTabs.Trigger.Label>{t("native.shell.tabProfile")}</NativeTabs.Trigger.Label>
        {/* A foto vem REDUZIDA a tamanho de icone (features/shell/tabAvatar):
            entregue crua, a UITabBar desenhava-a ao tamanho natural e a cara
            ocupava a barra inteira. Ate estar pronta - e se falhar - fica o
            simbolo do sistema, que tambem e o estado certo sem sessao.
            Sai QUADRADA: a barra nativa nao aplica mascara. */}
        {avatarIcon ? (
          <NativeTabs.Trigger.Icon src={{ uri: avatarIcon }} renderingMode="original" />
        ) : (
          <NativeTabs.Trigger.Icon sf="person.crop.circle" md="account_circle" />
        )}
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
