/**
 * Profile drawer (owner screenshot 2026-08-14, the Spotify left drawer):
 * opened by the avatar on Home. Header = avatar + name + "view profile"
 * (navigates to the own music profile), then shortcut rows. Hand-rolled on
 * a transparent Modal + reanimated slide, because the app has no
 * react-navigation drawer and one screen does not justify the dependency.
 */
import React, { useCallback } from "react";
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

const Row = ({
  icon,
  label,
  onPress,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
}) => {
  const { tokens } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 16,
        paddingHorizontal: 20,
        paddingVertical: 14,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Icon name={icon} size={22} color={tokens.foreground} />
      <Text style={{ color: tokens.foreground, fontSize: 16, fontWeight: "600" }}>{label}</Text>
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
          paddingTop: insets.top + 12,
          paddingBottom: insets.bottom + 12,
        }}
      >
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            if (user) go({ pathname: "/(main)/profile/[idOrHandle]", params: { idOrHandle: user.handle } });
          }}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 14,
            paddingHorizontal: 20,
            paddingBottom: 16,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          {user ? <ArtworkImage uri={avatarUrl(user.id)} size={56} shape="circle" /> : null}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              style={{ color: tokens.foreground, fontSize: 20, fontWeight: "800" }}
              numberOfLines={1}
            >
              {user?.name ?? ""}
            </Text>
            <Text style={{ color: tokens.mutedForeground, fontSize: 13, marginTop: 2 }}>
              {t("native.home.viewProfile")}
            </Text>
          </View>
        </Pressable>

        <View style={{ height: 1, backgroundColor: tokens.border, marginBottom: 8 }} />

        <Row icon="users" label={t("native.friends.title")} onPress={() => go("/(main)/friends")} />
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
