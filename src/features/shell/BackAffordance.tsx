/**
 * The back arrow every pushed screen was missing (owner report 2026-08-16,
 * point 12: "falta uma seta no canto superior esquerdo ao abrir playlists,
 * definicoes, etc. - o Spotify tem").
 *
 * Why it lives HERE and not in each screen. All four Stack navigators in the
 * app run `headerShown: false`, and the tab stack renders a bare `<Stack />`
 * with no `Stack.Screen` children, so there is no header to put a `headerLeft`
 * in and no per-route options object to hang one on. There is also no shared
 * screen-header component: every self-headed page inlines its own `<Text>`
 * title, and the collection screens use `Hero` instead. Adding an arrow to
 * each of the 22 pushed routes would mean 22 edits and 22 chances to drift.
 *
 * So the affordance floats, once, as a sibling of the tab's Stack - the same
 * shape `OverlayHost` already uses for the pill. It shows exactly when the
 * focused screen is NOT a tab root, which is the same signal `metrics.ts`
 * uses, and it is reactive because `useSegments` re-renders on every
 * navigation.
 *
 * Two things it deliberately does not do:
 *
 *  - it never renders inside the DESKTOP shell, where the topbar already has
 *    its own back control and the pointer has browser history besides;
 *  - it does not draw a bar. A bar would need a title, the pushed screens
 *    already draw their own, and stacking two headings is exactly the
 *    "billboard" the player and profile screens were pulled back from. It is
 *    one circular glyph over whatever is underneath, which is what Spotify
 *    puts over a playlist hero.
 *
 * The scrim disc is not decoration: half these screens open on a full-bleed
 * artwork hero whose top-left pixels can be any colour, and a bare chevron
 * disappears into a light one.
 */
import React from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import { photoScrim } from "@/ui/uiTheme";
import { GhostIconButton } from "@/ui/buttons";
import { useDesktopShell } from "@/ui/shellLayout";
import { BACK_BUTTON_SIZE, BACK_BUTTON_TOP_GAP, useAtTabRoot } from "./metrics";

export const BackAffordance = () => {
  const t = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { scheme } = useTheme();
  const desktop = useDesktopShell();
  const atTabRoot = useAtTabRoot();

  // A tab root has nothing to go back TO inside its own stack, and the
  // desktop shell owns its own back control.
  if (desktop || atTabRoot) return null;

  return (
    <View
      // `box-none`: the disc takes touches, the rest of this layer must not
      // steal them from the screen underneath.
      pointerEvents="box-none"
      style={{
        position: "absolute",
        top: insets.top + BACK_BUTTON_TOP_GAP,
        left: 8,
      }}
    >
      <View
        style={{
          width: BACK_BUTTON_SIZE,
          height: BACK_BUTTON_SIZE,
          borderRadius: BACK_BUTTON_SIZE / 2,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: photoScrim(scheme === "dark" ? 0.45 : 0.3),
        }}
      >
        <GhostIconButton
          icon="chevron-left"
          size={22}
          color="#ffffff"
          accessibilityLabel={t("components.music.TopBar.goBack")}
          onPress={() => {
            // `canGoBack` is checked at PRESS time, not render time: the
            // stack can be one deep on a deep link, and dismissing to a tab
            // root is a better answer than a dead button.
            if (router.canGoBack()) router.back();
            else router.replace("/home");
          }}
        />
      </View>
    </View>
  );
};
