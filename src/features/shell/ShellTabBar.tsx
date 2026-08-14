/**
 * Default bottom tab bar wrapped in a measuring View: the real rendered
 * height feeds metrics.ts so the overlay host can float the MiniPlayer pill
 * exactly above the bar without hardcoding platform heights.
 *
 * In the DESKTOP shell (web, >= 900px of window) the bar does not render at
 * all: the sidebar owns navigation there, and metrics.ts stops consulting
 * the measured height behind the same gate. Below 900px (and on native,
 * always) the bar is exactly what it always was.
 *
 * NATIVE gains a 4th item (owner request 2026-08-14): the session user's
 * avatar, always present, which opens the ProfileDrawer instead of
 * navigating anywhere. It sits as a SIBLING of the BottomTabBar (not a
 * Tabs.Screen) so expo-router never treats it as a route. Web below 900px
 * stays frozen - the mobile web shell keeps its exact three tabs.
 */
import React from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { BottomTabBar, type BottomTabBarProps } from "expo-router/js-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { avatarUrl } from "@/api/mediaUrl";
import { useSessionStore } from "@/auth/session";
import { openProfileDrawer } from "@/features/home/ProfileDrawer";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import { ArtworkImage, Icon } from "@/ui";
import { useDesktopShell } from "@/ui/shellLayout";
import { setMeasuredTabBarHeight } from "./metrics";

/** Same circle scale as the tab glyphs (24px icons, avatar reads a touch
 *  larger because it is a filled disc). */
const AVATAR_SIZE = 26;

const AvatarTabItem = () => {
  const t = useT();
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  // Same avatar source as the drawer header; the id is enough (the picture
  // endpoint is public) and survives the profile query not being warm yet.
  const userId = useSessionStore((s) => s.user?.id ?? s.session?.user_id ?? null);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("native.shell.tabProfile")}
      onPress={openProfileDrawer}
      style={({ pressed }) => ({
        width: 64,
        alignItems: "center",
        justifyContent: "center",
        // The BottomTabBar pads its own bottom with the safe-area inset;
        // matching it keeps the avatar vertically aligned with the icons.
        paddingBottom: insets.bottom,
        backgroundColor: tokens.background,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: tokens.border,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      {userId ? (
        <ArtworkImage uri={avatarUrl(userId)} size={AVATAR_SIZE} shape="circle" />
      ) : (
        // Signed out: a neutral disc with the user glyph, same footprint.
        <View
          style={{
            width: AVATAR_SIZE,
            height: AVATAR_SIZE,
            borderRadius: AVATAR_SIZE / 2,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: tokens.secondary,
          }}
        >
          <Icon name="user" size={14} color={tokens.mutedForeground} />
        </View>
      )}
    </Pressable>
  );
};

export const ShellTabBar = (props: BottomTabBarProps) => {
  const desktop = useDesktopShell();
  if (desktop) return null;
  return (
    <View
      onLayout={(event) => setMeasuredTabBarHeight(Math.round(event.nativeEvent.layout.height))}
      style={{ flexDirection: "row", alignItems: "stretch" }}
    >
      <View style={{ flex: 1 }}>
        <BottomTabBar {...props} />
      </View>
      {Platform.OS !== "web" ? <AvatarTabItem /> : null}
    </View>
  );
};
