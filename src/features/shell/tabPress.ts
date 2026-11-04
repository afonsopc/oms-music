/**
 * O que um toque numa tab do sistema deve fazer à stack dessa tab (queixa de
 * um utilizador a 2026-11-04: no Android, com as Definições abertas, tocar em
 * "Início" não fazia nada).
 *
 * Porque é preciso. Com as NativeTabs o expo-router 57 desliga de propósito o
 * popToTop do lado JS (fork/native-stack/createNativeStackNavigator.js: "the
 * popToTop will be automatically triggered on native side for native tabs") e
 * confia no react-native-screens. No iOS o UITabBarController fá-lo. No
 * Android o TabsContainer procura a ScreenStack só na cadeia dos PRIMEIROS
 * filhos (ViewFinder.findScreenStackInFirstDescendantChain), e a nossa stack
 * vive dentro de um View com a seta e o OverlayHost ao lado, por isso nunca a
 * encontra: o toque repetido não tirava nada de cima. O mesmo para o
 * scrollToTop, que se resolve em useTabScrollToTop.
 *
 * Regras (pedido do dono):
 *  - tocar numa tab mostra SEMPRE a raiz dela, fechando o que estiver
 *    empurrado por cima (definições, conta, álbum...), em ambos os sistemas;
 *  - tocar na tab que já está aberta volta à raiz; no iOS isso já é nativo e
 *    não se repete aqui (dois popToTop seguidos davam dois saltos).
 *
 * Puro e sem React, para ser testado em __tests__/tabPress.test.ts.
 */

type StackStateLike = { key?: string; index?: number };
type TabRouteLike = { key: string; state?: StackStateLike };
type TabsStateLike = { index: number; routes: readonly TabRouteLike[] };

/**
 * A chave da stack a levar à raiz, ou null quando não há nada a fazer.
 * `platform` é o Platform.OS.
 */
export const tabPressPopTarget = (
  tabs: TabsStateLike,
  targetKey: string,
  platform: string,
): string | null => {
  const target = tabs.routes.find((route) => route.key === targetKey);
  const stack = target?.state;
  if (!stack?.key || !stack.index || stack.index <= 0) return null;
  const repeated = tabs.routes[tabs.index]?.key === targetKey;
  if (repeated && platform === "ios") return null;
  return stack.key;
};
