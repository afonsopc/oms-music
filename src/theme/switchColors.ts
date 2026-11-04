import type { ThemeTokens } from "./tokens";

/**
 * Colors for a platform <Switch/>, em neutros (redesenho 2026-11-04).
 *
 * Ligado: o trilho é a cor do texto (quase branco no escuro, quase preto no
 * claro) e o botão cinzento-escuro/claro (`muted`), por isso o "ligado" lê-se como uma peça
 * invertida e nunca como branco sobre branco (o que já aconteceu com o
 * `primary` e o botão branco do sistema). Desligado: trilho `muted` e botão
 * branco do sistema. Precisa do valor para escolher o botão.
 */
export const switchColors = (tokens: ThemeTokens, value: boolean) => ({
  trackColor: { false: tokens.muted, true: tokens.foreground },
  ios_backgroundColor: tokens.muted,
  // `muted` e não o fundo: um botão da cor do fundo na ponta do trilho
  // parecia cortado na web.
  thumbColor: value ? tokens.muted : "#ffffff",
  activeThumbColor: tokens.muted,
});
