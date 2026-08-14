/**
 * Root layout (DESIGN 2): provider stack in exact order
 * ThemeProvider > I18nProvider > QueryClientProvider > SessionGate >
 * DownloadStatusProvider > gesture root, plus the side-effect import of
 * boot/wireup.ts. i18n needs no React provider (src/i18n is store-based;
 * useT re-renders on locale change), and the DownloadStatusProvider position
 * is the SlotProviders slot, filled by WP8 through boot/wireup.ts.
 */
import "@/boot/wireup";
import React, { useEffect } from "react";
import { Stack, ThemeProvider as NavigationThemeProvider, usePathname } from "expo-router";
import Head from "expo-router/head";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { QueryClientProvider } from "@tanstack/react-query";
import { hydrateQueryCache, startQueryCachePersistence } from "@/api/persistCache";
import { queryClient, wireQueryClient } from "@/api/queryClient";
import { useSessionStore } from "@/auth/session";
import { SessionGate } from "@/features/shell/SessionGate";
import { routeTitle } from "@/features/shell/routeTitles";
import { SlotProviders } from "@/features/shell/slots";
import { ThemeProvider, useTheme } from "@/theme/provider";

SplashScreen.preventAutoHideAsync().catch(() => {});

/**
 * Document <title>, resolved from the pathname ABOVE the SessionGate: while
 * the gate holds the tree back (always, during the static prerender - no
 * effects run in Node, so the session never leaves "booting"), no screen and
 * therefore no screen-level <Head> can serialize into the exported HTML.
 * This is the one spot that titles every prerendered shell AND tracks
 * client-side navigation; src/features/shell/routeTitles.ts explains the
 * full argument. On native, expo-router/head is a no-op and nothing renders.
 */
const RouteTitle = () => {
  const pathname = usePathname();
  return (
    <Head>
      <title>{routeTitle(pathname)}</title>
    </Head>
  );
};

/**
 * Every navigator in the app sits under ONE react-navigation theme derived
 * from the tokens. Nested navigators that do not spell out a background
 * inherit it from here, which is what stops a screen from rendering on the
 * default LIGHT navigation card while its contents use the dark palette.
 */
const RootNavigator = () => {
  const status = useSessionStore((s) => s.status);
  const { tokens, scheme, navigationTheme } = useTheme();
  const authed = status === "authed";
  return (
    <NavigationThemeProvider value={navigationTheme}>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: tokens.background },
        }}
      >
        <Stack.Protected guard={authed}>
          <Stack.Screen name="(main)" />
          {/* "modal", not "fullScreenModal": on iOS only the sheet
              presentation can be dragged down to dismiss, and a now playing
              screen that can only be closed by hunting for a small chevron at
              the top reads as broken. The grabber comes for free. */}
          <Stack.Screen
            name="(player)"
            options={{
              presentation: "modal",
              animation: "slide_from_bottom",
              gestureEnabled: true,
            }}
          />
          <Stack.Screen name="jam" options={{ presentation: "modal" }} />
        </Stack.Protected>
        <Stack.Protected guard={!authed}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
      </Stack>
    </NavigationThemeProvider>
  );
};

export default function RootLayout() {
  useEffect(() => {
    wireQueryClient();
    // Local-first boot: yesterday's library renders in the FIRST frame the
    // authed screens mount; the network only revalidates it afterwards.
    hydrateQueryCache();
    startQueryCachePersistence();
  }, []);

  return (
    <>
      <RouteTitle />
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <SessionGate>
            <SlotProviders>
              <GestureHandlerRootView style={{ flex: 1 }}>
                <RootNavigator />
              </GestureHandlerRootView>
            </SlotProviders>
          </SessionGate>
        </QueryClientProvider>
      </ThemeProvider>
    </>
  );
}
