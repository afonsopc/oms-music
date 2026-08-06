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
import { Stack, ThemeProvider as NavigationThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient, wireQueryClient } from "@/api/queryClient";
import { useSessionStore } from "@/auth/session";
import { SessionGate } from "@/features/shell/SessionGate";
import { SlotProviders } from "@/features/shell/slots";
import { ThemeProvider, useTheme } from "@/theme/provider";

SplashScreen.preventAutoHideAsync().catch(() => {});

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
          <Stack.Screen
            name="(player)"
            options={{ presentation: "fullScreenModal", animation: "slide_from_bottom" }}
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
  }, []);

  return (
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
  );
}
