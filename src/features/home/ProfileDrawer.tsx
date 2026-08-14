/**
 * Profile drawer (owner screenshot 2026-08-14, the Spotify left drawer):
 * opened by the avatar on Home AND by the avatar item in the mobile tab bar
 * (owner request 2026-08-14). Header = avatar + name + handle + a "view
 * profile" affordance (navigates to the own music profile), then shortcut
 * rows in the settings-row design language. Hand-rolled on a transparent
 * Modal + reanimated slide, because the app has no react-navigation drawer
 * and one screen does not justify the dependency.
 *
 * Because the tab bar can open it from ANY tab, the drawer no longer mounts
 * inside the Home fragment: ProfileDrawerHost lives at the shell level
 * ((main)/_layout) and follows the module-level open/close store below
 * (same pattern as shell/metrics.ts).
 */
import React, { useCallback, useSyncExternalStore } from "react";
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import Animated, { FadeIn, FadeOut, SlideInLeft, SlideOutLeft } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { avatarUrl } from "@/api/mediaUrl";
import { useSessionStore } from "@/auth/session";
import { useT } from "@/i18n";
import { modalScrim } from "@/ui/uiTheme";
import { useTheme } from "@/theme/provider";
import { ArtworkImage, Icon, type IconName } from "@/ui";

// ---------------------------------------------------------------------------
// Open/close store: any surface (Home header, tab bar avatar) opens the one
// drawer instance mounted by ProfileDrawerHost at the shell level.
// ---------------------------------------------------------------------------

let drawerOpen = false;
const listeners = new Set<() => void>();

const emit = (): void => {
  for (const cb of listeners) cb();
};

export const openProfileDrawer = (): void => {
  if (drawerOpen) return;
  drawerOpen = true;
  emit();
};

export const closeProfileDrawer = (): void => {
  if (!drawerOpen) return;
  drawerOpen = false;
  emit();
};

const subscribeDrawer = (cb: () => void): (() => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

const getDrawerOpen = (): boolean => drawerOpen;

export const useProfileDrawerOpen = (): boolean =>
  useSyncExternalStore(subscribeDrawer, getDrawerOpen, getDrawerOpen);

/** Shell-level mount ((main)/_layout): one drawer, reachable from any tab. */
export const ProfileDrawerHost = () => {
  const visible = useProfileDrawerOpen();
  return <ProfileDrawer visible={visible} onClose={closeProfileDrawer} />;
};

// ---------------------------------------------------------------------------
// Drawer body
// ---------------------------------------------------------------------------

/** Shortcut rows share the settings-row design language (features/settings/ui
 *  SettingsRow): 20px muted icon, 15/600 label, 16/14 padding, hairline
 *  separators between rows. */
const Row = ({
  icon,
  label,
  onPress,
  first = false,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  first?: boolean;
}) => {
  const { tokens } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 20,
        paddingVertical: 14,
        borderTopWidth: first ? 0 : StyleSheet.hairlineWidth,
        borderTopColor: tokens.border,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Icon name={icon} size={20} color={tokens.mutedForeground} />
      <Text style={{ flex: 1, color: tokens.foreground, fontSize: 15, fontWeight: "600" }}>
        {label}
      </Text>
      <Icon name="chevron-right" size={18} color={tokens.mutedForeground} />
    </Pressable>
  );
};

export const ProfileDrawer = ({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) => {
  const { tokens, scheme } = useTheme();
  const t = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const user = useSessionStore((s) => s.user);

  const go = useCallback(
    (route: Href) => {
      onClose();
      router.push(route);
    },
    [onClose, router],
  );

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <Animated.View
        entering={FadeIn.duration(180)}
        exiting={FadeOut.duration(180)}
        style={[StyleSheet.absoluteFill, { backgroundColor: modalScrim(scheme) }]}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>
      <Animated.View
        entering={SlideInLeft.duration(240)}
        exiting={SlideOutLeft.duration(200)}
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: 0,
          width: Math.min(width * 0.82, 360),
          backgroundColor: tokens.background,
          paddingTop: insets.top + 16,
          // Safe area at the bottom so the last row never sits under the
          // home indicator.
          paddingBottom: Math.max(insets.bottom, 12) + 8,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("native.home.viewProfile")}
          onPress={() => {
            if (user) go({ pathname: "/(main)/profile/[idOrHandle]", params: { idOrHandle: user.handle } });
          }}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 16,
            paddingHorizontal: 20,
            paddingBottom: 20,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          {user ? <ArtworkImage uri={avatarUrl(user.id)} size={64} shape="circle" /> : null}
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text
              style={{ color: tokens.foreground, fontSize: 20, fontWeight: "800" }}
              numberOfLines={1}
            >
              {user?.name ?? ""}
            </Text>
            {user?.handle ? (
              <Text
                style={{ color: tokens.mutedForeground, fontSize: 13 }}
                numberOfLines={1}
              >
                @{user.handle}
              </Text>
            ) : null}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 2, marginTop: 4 }}>
              <Text style={{ color: tokens.foreground, fontSize: 13, fontWeight: "600" }}>
                {t("native.home.viewProfile")}
              </Text>
              <Icon name="chevron-right" size={14} color={tokens.mutedForeground} />
            </View>
          </View>
        </Pressable>

        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: tokens.border, marginBottom: 8 }} />

        <Row first icon="users" label={t("native.friends.title")} onPress={() => go("/(main)/friends")} />
        <Row
          icon="download"
          label={t("native.shell.tabDownloads")}
          onPress={() => go("/(main)/settings/downloads-overview")}
        />
        <Row
          icon="settings"
          label={t("native.library.settings")}
          onPress={() => go("/(main)/settings")}
        />
      </Animated.View>
    </Modal>
  );
};
