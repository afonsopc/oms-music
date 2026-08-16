/**
 * Geometria dos overlays (FR-16). O host flutua a pill do MiniPlayer acima da
 * barra de tabs e todos os ecras rolaveis pagam useContentBottomPadding() no
 * fundo, para a cauda das listas nunca ficar tapada - a convencao contra a
 * qual as features estao escritas.
 *
 * A FONTE de verdade mudou em 2026-08-15, por duas razoes que se somam:
 *
 *  1. no nativo a barra deixou de ser nossa (era um capsulo em vidro nosso,
 *     medido com um onLayout) e passou a ser a do SISTEMA
 *     (expo-router/unstable-native-tabs), que nao se mede e que nem sequer
 *     publica BottomTabBarHeightContext (o useBottomTabBarHeight() ATIRA
 *     dentro das native tabs);
 *  2. o OverlayHost desceu do (main) para dentro da stack de CADA tab, ou
 *     seja passou a viver DENTRO da cena da tab em todas as plataformas.
 *
 * O (2) e o que decide as contas: a cena da tab ja acaba onde a barra
 * comeca, por isso o offset da pill deixou de ser "altura da barra" e passou
 * a ser so o que falta do safe area DENTRO da cena. Por plataforma:
 *
 *  - iOS: o UITabBarController estende a cena POR BAIXO da barra e injecta-a
 *    no safe area do view controller filho (o NativeTabsView.ios monta um
 *    SafeAreaProvider NOVO por tab), portanto insets.bottom medido aqui ja e
 *    "barra + home indicator";
 *  - Android: o NativeTabsView.android embrulha a cena num SafeAreaView
 *    edges={{bottom:true}}, ou seja o conteudo ja vem recortado ACIMA da
 *    barra e somar-lhe o inset seria paga-la a dobrar;
 *  - web: a ShellTabBar e uma LINHA do navegador de tabs (flex column), nao
 *    um overlay, e ela propria ja paga o insets.bottom. Nas raizes das tabs
 *    a cena acaba no topo da barra e nao ha nada a somar; nas rotas
 *    empurradas a barra nao renderiza (ver ShellTabBar), a cena volta a ser
 *    o ecra todo e o inset de baixo (Safari em standalone) volta a contar.
 */
import { Platform } from "react-native";
import { useSegments } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useDesktopShell } from "@/ui/shellLayout";

/** Diameter of the floating back arrow's scrim disc (BackAffordance). */
export const BACK_BUTTON_SIZE = 36;
/** Gap between the safe-area top and that disc. */
export const BACK_BUTTON_TOP_GAP = 4;
/**
 * Vertical room a self-headed pushed screen adds so its own title clears the
 * floating back arrow. Lives here, with the other overlay geometry, so
 * `useContentTopPadding` can spend it without importing the component (which
 * reads `useAtTabRoot` from this file - the other direction would be a cycle).
 */
export const BACK_AFFORDANCE_ROOM = BACK_BUTTON_SIZE + BACK_BUTTON_TOP_GAP + 4;

/** Pill height (web mobile mini player: 64px, rounded-xl). */
export const OVERLAY_PILL_HEIGHT = 64;
/** Gap between the pill and whatever it floats above (web: inset 8). */
export const OVERLAY_MARGIN = 8;

/**
 * Bottom padding of the main pane's scrollables inside the DESKTOP shell:
 * the transport bar is a grid ROW below the pane, not an overlay, so there
 * is no pill to clear - just breathing room for the last list item.
 */
const DESKTOP_CONTENT_BOTTOM = 24;

/** As raizes das tres tabs; tudo o resto e um push dentro da stack de uma. */
const TAB_ROOTS = new Set(["home", "search", "library"]);

/**
 * O ecra focado e a RAIZ de uma tab (e nao um push la dentro)? Desde a
 * migracao para native tabs as ~21 rotas empurradas passaram a viver DENTRO
 * das tabs, por isso `segments.includes("(tabs)")` passou a ser sempre
 * verdadeiro e deixou de distinguir seja o que for.
 */
export const useAtTabRoot = (): boolean => {
  const segments = useSegments() as string[];
  return TAB_ROOTS.has(segments[segments.length - 1] ?? "");
};

/** Distance from the screen bottom to the overlay's bottom edge. */
export const useOverlayBottomOffset = (): number => {
  const insets = useSafeAreaInsets();
  const desktop = useDesktopShell();
  const atTabRoot = useAtTabRoot();

  // Desktop shell: nao ha barra nenhuma nem pill (o transporte e uma LINHA
  // da grelha), os overlays que restam (banner de offline, JamBar) flutuam
  // logo acima do limite do painel.
  if (desktop) return OVERLAY_MARGIN;

  // Web: a barra classica ja paga o safe area por dentro dela, por isso nas
  // raizes das tabs some-lo outra vez levantava a pill uma barra inteira
  // acima do sitio de sempre.
  if (Platform.OS === "web") return (atTabRoot ? 0 : insets.bottom) + OVERLAY_MARGIN;

  // Nativo: no iOS a barra do sistema esta no safe area da cena; no Android
  // a cena ja vem recortada acima dela.
  return (Platform.OS === "ios" ? insets.bottom : 0) + OVERLAY_MARGIN;
};

/**
 * Bottom padding every scrollable screen applies (FR-16 AC: the pill never
 * covers list tails). Constant whether or not a song is loaded, so lists do
 * not jump when playback starts. In the desktop shell there is no floating
 * pill (the transport bar is a grid row), so no tab-bar-height math applies.
 */
export const useContentBottomPadding = (): number => {
  const offset = useOverlayBottomOffset();
  const desktop = useDesktopShell();
  return desktop ? DESKTOP_CONTENT_BOTTOM : offset + OVERLAY_PILL_HEIGHT + OVERLAY_MARGIN;
};

/**
 * Top padding of plain stack pages inside the DESKTOP shell: there is no
 * status bar or island to clear (insets.top is 0 in a browser), so without
 * a fixed band every self-headed page glued its title to the topbar row.
 * One constant so friends, settings, downloads and profile all breathe the
 * same amount.
 */
const DESKTOP_CONTENT_TOP = 32;

/**
 * Top padding for a scrollable screen that draws its OWN heading rather than
 * a Hero. The Hero applies the inset itself, so collection screens must not
 * use this or they would pay it twice; downloads and settings do, which is
 * why their titles sat under the dynamic island. In the desktop shell the
 * safe-area inset is 0 and `extra` alone was too tight, so a fixed
 * comfortable band replaces the whole sum there - callers keep their mobile
 * rhythm untouched.
 */
export const useContentTopPadding = (extra = 16): number => {
  const insets = useSafeAreaInsets();
  const desktop = useDesktopShell();
  const atTabRoot = useAtTabRoot();
  if (desktop) return DESKTOP_CONTENT_TOP;
  // A pushed screen carries the floating back arrow (BackAffordance), which
  // occupies the top-left corner these screens draw their own title into.
  // Paying for it HERE is what keeps the arrow out of every screen's code:
  // the fourteen self-headed pages already call this hook, so they all make
  // room without knowing the arrow exists. Hero screens deliberately do not
  // call it - there the arrow is meant to float over the artwork.
  return insets.top + extra + (atTabRoot ? 0 : BACK_AFFORDANCE_ROOM);
};
