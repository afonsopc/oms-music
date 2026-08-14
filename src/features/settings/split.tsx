/**
 * Settings split view (plano-uma-so-app 4.3, settings row): at desktop
 * widths the settings area renders as TWO columns - the section list on
 * the left, the active section's detail on the right - and navigation
 * REPLACES the route instead of pushing, so there is no stack to walk back
 * out of. Below 900px this whole file is a pass-through: the mobile
 * settings keep their hub-and-push shape untouched.
 *
 * The route files under app/(main)/settings/ wrap their screens in
 * SettingsRouteShell rather than this living in a _layout: a nested Stack
 * would restructure MOBILE navigation too, and the mobile shell is frozen.
 */
import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import { RADIUS } from "@/theme/tokens";
import { Icon, useDesktopShell, type IconName } from "@/ui";
import { foregroundWash } from "@/ui/uiTheme";

export type SettingsSection =
  | "general"
  | "import"
  | "songs"
  | "artists"
  | "playback"
  | "downloads-overview"
  | "downloads"
  | "devices"
  | "passkeys";

interface SectionEntry {
  id: SettingsSection;
  icon: IconName;
  /** Reuses the hub rows' exact labels - one vocabulary, two layouts. */
  labelKey: string;
  route: string;
}

/** Same order and same icons as the mobile hub's rows. */
const SECTIONS: SectionEntry[] = [
  {
    id: "general",
    icon: "settings",
    labelKey: "native.desktop.settingsGeneral",
    route: "/(main)/settings",
  },
  {
    id: "import",
    icon: "download",
    labelKey: "components.music.Settings.import",
    route: "/(main)/settings/import",
  },
  {
    id: "songs",
    icon: "music",
    labelKey: "components.music.Settings.songs",
    route: "/(main)/settings/songs",
  },
  {
    id: "artists",
    icon: "user",
    labelKey: "components.music.Settings.artists",
    route: "/(main)/settings/artists",
  },
  {
    id: "playback",
    icon: "audio-waveform",
    labelKey: "components.music.Settings.PlaybackPage.title",
    route: "/(main)/settings/playback",
  },
  {
    id: "downloads-overview",
    icon: "download",
    labelKey: "native.shell.tabDownloads",
    route: "/(main)/settings/downloads-overview",
  },
  {
    id: "downloads",
    icon: "cloud-check",
    labelKey: "native.settings.hub.rowDownloads",
    route: "/(main)/settings/downloads",
  },
  {
    id: "devices",
    icon: "cast",
    labelKey: "native.settings.hub.rowDevices",
    route: "/(main)/settings/devices",
  },
  {
    id: "passkeys",
    icon: "circle-check",
    labelKey: "native.settings.hub.rowPasskeys",
    route: "/(main)/settings/passkeys",
  },
];

const NAV_WIDTH = 280;

export interface SettingsRouteShellProps {
  section: SettingsSection;
  children: React.ReactNode;
}

/**
 * Wraps every settings route. Mobile: children pass through untouched.
 * Desktop: section list left, the wrapped screen right, `router.replace`
 * between sections so Back leaves settings entirely instead of unwinding
 * every section the user glanced at.
 */
export const SettingsRouteShell = ({ section, children }: SettingsRouteShellProps) => {
  const desktop = useDesktopShell();
  const router = useRouter();
  const t = useT();
  const { tokens, scheme } = useTheme();

  if (!desktop) return <>{children}</>;

  return (
    <View style={{ flex: 1, flexDirection: "row", backgroundColor: tokens.background }}>
      <ScrollView
        style={{
          width: NAV_WIDTH,
          flexGrow: 0,
          flexShrink: 0,
          borderRightWidth: 1,
          borderRightColor: tokens.border,
        }}
        contentContainerStyle={{ padding: 16, gap: 4 }}
      >
        <Text
          style={{
            color: tokens.foreground,
            fontSize: 22,
            fontWeight: "800",
            paddingHorizontal: 8,
            paddingBottom: 12,
          }}
        >
          {t("native.settings.hub.title")}
        </Text>
        {SECTIONS.map((entry) => {
          const active = entry.id === section;
          return (
            <Pressable
              key={entry.id}
              onPress={() => {
                if (!active) router.replace(entry.route as never);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                paddingHorizontal: 12,
                paddingVertical: 10,
                borderRadius: RADIUS,
                backgroundColor: active
                  ? foregroundWash(scheme, 0.1)
                  : pressed
                    ? foregroundWash(scheme, 0.05)
                    : "transparent",
              })}
            >
              <Icon
                name={entry.icon}
                size={18}
                color={active ? tokens.foreground : tokens.mutedForeground}
              />
              <Text
                style={{
                  color: active ? tokens.foreground : tokens.mutedForeground,
                  fontSize: 14,
                  fontWeight: active ? "700" : "500",
                  flex: 1,
                }}
                numberOfLines={1}
              >
                {t(entry.labelKey)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={{ flex: 1, minWidth: 0 }}>{children}</View>
    </View>
  );
};
