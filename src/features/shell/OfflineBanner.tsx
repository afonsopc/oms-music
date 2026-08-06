/**
 * Standing "you are offline" strip.
 *
 * The app already degraded gracefully offline (queries fall back to the
 * downloaded library), but it did so SILENTLY: a library that quietly shrinks
 * to the downloaded songs looks like data loss rather than a network state.
 * This says which of the two it is, once, for the whole app.
 *
 * It sits in the overlay host above the mini player, so it never pushes layout
 * around and never needs a screen to know about it.
 */
import React, { useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { isOffline, subscribeOnlineState } from "@/downloads/offlineLibrary";
import { useT } from "@/i18n";
import { onColor } from "@/theme/contrast";
import { MUSIC_ACCENT } from "@/theme/tokens";

const subscribe = (cb: () => void): (() => void) => subscribeOnlineState(() => cb());

export const useIsOffline = (): boolean => useSyncExternalStore(subscribe, isOffline, isOffline);

export const OfflineBanner = () => {
  const offline = useIsOffline();
  const insets = useSafeAreaInsets();
  const t = useT();

  if (!offline) return null;

  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        paddingTop: insets.top + 6,
        paddingBottom: 8,
        paddingHorizontal: 16,
        backgroundColor: MUSIC_ACCENT,
        alignItems: "center",
      }}
    >
      <Text
        style={{ color: onColor(MUSIC_ACCENT), fontSize: 13, fontWeight: "700" }}
        numberOfLines={1}
        accessibilityRole="alert"
      >
        {t("native.common.offlineBanner")}
      </Text>
    </View>
  );
};
