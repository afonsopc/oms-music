/**
 * A barra classica do navegador de tabs. SO a web abaixo de 900px:
 *
 *  - no shell DESKTOP (web, >= 900px) nao renderiza, quem navega la e a
 *    sidebar;
 *  - no NATIVO tambem nao, e desde 2026-08-15 nem sequer chega la: a barra
 *    passou a ser a do SISTEMA (expo-router/unstable-native-tabs) e quem
 *    importa este ficheiro e o (tabs)/_layout.web.tsx, nao o layout nativo.
 *    A guarda de Platform fica na mesma, que o bundler nao e o contrato.
 *
 * Ja nao mede a propria altura (mediu ate 2026-08-15 para o metrics.ts
 * pousar a pill do MiniPlayer): a barra e uma LINHA do navegador (flex
 * column), portanto a cena da tab - onde o OverlayHost agora vive - acaba
 * exactamente onde a barra comeca e nao ha altura nenhuma a somar. Se
 * alguma vez voltar a ser precisa, o proprio BottomTabView ja a publica em
 * BottomTabBarHeightContext.
 */
import React from "react";
import { Platform } from "react-native";
import { BottomTabBar, type BottomTabBarProps } from "expo-router/js-tabs";
import { useSegments } from "expo-router";
import { useDesktopShell } from "@/ui/shellLayout";
import { useAtTabRoot } from "./metrics";

export const ShellTabBar = (props: BottomTabBarProps) => {
  const desktop = useDesktopShell();
  const atTabRoot = useAtTabRoot();
  const segments = useSegments() as string[];

  if (desktop) return null;
  if (Platform.OS !== "web") return null;
  // Congelado de proposito: ate 2026-08-15 as ~21 rotas empurradas eram
  // IRMAS do navegador de tabs e esta barra nao existia nelas. Agora vivem
  // DENTRO das tabs, e sem esta guarda a web mobile ganhava uma barra que
  // nunca teve.
  //
  // A guarda pede as duas coisas (dentro das tabs E fora de uma raiz) em vez
  // so de "fora de uma raiz": no player, no jam e na galeria o foco sai do
  // navegador de tabs e ai a barra sempre continuou montada por baixo do
  // modal. Desmonta-la nesses ecras encolhia e esticava a cena da tab por
  // tras do modal, e o scroll das listas saltava ao fechar.
  if (segments.includes("(tabs)") && !atTabRoot) return null;

  return <BottomTabBar {...props} />;
};
