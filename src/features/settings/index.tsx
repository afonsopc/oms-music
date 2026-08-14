/**
 * Settings hub (FR-95): Import / Songs / Artists / Playback plus the
 * native-only Downloads settings and Devices entries, and the app prefs
 * inline - theme light/dark/system (FR-18 UI) and language en/pt/lv
 * (FR-19 UI). Screen bodies live in their own files; this screen only
 * navigates.
 */
import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useContentBottomPadding, useContentTopPadding } from "@/features/shell/metrics";
import { LOCALES, setLocale, useLocale, useT, type Locale } from "@/i18n";
import { useTheme, type ThemeMode } from "@/theme/provider";
import { useDesktopShell } from "@/ui";
import { SettingsRow, SettingsSection } from "./ui";

const THEME_MODES: readonly ThemeMode[] = ["light", "dark", "system"];

const LANGUAGE_LABEL_KEYS: Record<Locale, string> = {
  en: "native.settings.hub.languageEn",
  pt: "native.settings.hub.languagePt",
  lv: "native.settings.hub.languageLv",
};

const SegmentedRow = <T extends string>({
  options,
  labels,
  value,
  onChange,
}: {
  options: readonly T[];
  labels: Record<T, string>;
  value: T;
  onChange: (next: T) => void;
}) => {
  const { tokens } = useTheme();
  return (
    <View style={{ flexDirection: "row", gap: 8, padding: 12 }}>
      {options.map((option) => {
        const active = option === value;
        return (
          <Pressable
            key={option}
            onPress={() => onChange(option)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={({ pressed }) => ({
              flex: 1,
              alignItems: "center",
              paddingVertical: 10,
              borderRadius: 999,
              backgroundColor: active ? tokens.primary : tokens.secondary,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Text
              style={{
                color: active ? tokens.primaryForeground : tokens.foreground,
                fontSize: 13,
                fontWeight: "600",
              }}
            >
              {labels[option]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
};

export default function SettingsHubScreen() {
  const t = useT();
  const router = useRouter();
  const { tokens, mode, setMode } = useTheme();
  const locale = useLocale();
  const bottomPadding = useContentBottomPadding();
  const topPadding = useContentTopPadding();
  // Desktop (plan 4.3, settings row): the split shell already lists every
  // section on the left, so this screen becomes the "General" DETAIL only -
  // theme and language, no duplicate navigation rows. Mobile keeps the hub.
  const desktop = useDesktopShell();

  const themeLabels: Record<ThemeMode, string> = {
    light: t("native.settings.hub.themeLight"),
    dark: t("native.settings.hub.themeDark"),
    system: t("native.settings.hub.themeSystem"),
  };
  const languageLabels = Object.fromEntries(
    LOCALES.map((l) => [l, t(LANGUAGE_LABEL_KEYS[l])]),
  ) as Record<Locale, string>;

  if (desktop) {
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: tokens.background }}
        contentContainerStyle={{ padding: 24, gap: 20 }}
      >
        <Text style={{ color: tokens.foreground, fontSize: 28, fontWeight: "800" }}>
          {t("native.desktop.settingsGeneral")}
        </Text>
        <SettingsSection title={t("native.settings.hub.theme")}>
          <SegmentedRow
            options={THEME_MODES}
            labels={themeLabels}
            value={mode}
            onChange={setMode}
          />
        </SettingsSection>
        <SettingsSection title={t("native.settings.hub.language")}>
          <SegmentedRow
            options={LOCALES}
            labels={languageLabels}
            value={locale}
            onChange={setLocale}
          />
        </SettingsSection>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: tokens.background }}
      contentContainerStyle={{ padding: 16, paddingTop: topPadding, paddingBottom: bottomPadding, gap: 20 }}
    >
      <Text style={{ color: tokens.foreground, fontSize: 28, fontWeight: "800" }}>
        {t("native.settings.hub.title")}
      </Text>

      <SettingsSection title={t("native.settings.hub.sectionLibrary")}>
        <SettingsRow
          first
          icon="download"
          label={t("components.music.Settings.import")}
          detail={t("components.music.Settings.ImportPage.description")}
          onPress={() => router.push("/(main)/settings/import")}
        />
        <SettingsRow
          icon="music"
          label={t("components.music.Settings.songs")}
          detail={t("components.music.Settings.SongsPage.description")}
          onPress={() => router.push("/(main)/settings/songs")}
        />
        <SettingsRow
          icon="user"
          label={t("components.music.Settings.artists")}
          detail={t("components.music.Settings.ArtistsPage.description")}
          onPress={() => router.push("/(main)/settings/artists")}
        />
      </SettingsSection>

      <SettingsSection title={t("native.settings.hub.sectionPlayback")}>
        <SettingsRow
          first
          icon="audio-waveform"
          label={t("components.music.Settings.PlaybackPage.title")}
          detail={t("components.music.Settings.PlaybackPage.subtitle")}
          onPress={() => router.push("/(main)/settings/playback")}
        />
        <SettingsRow
          icon="download"
          label={t("native.shell.tabDownloads")}
          detail={t("native.downloadsOverview.rowDetail")}
          onPress={() => router.push("/(main)/settings/downloads-overview")}
        />
        {/* Distinct label from the downloads OVERVIEW row above: both read
            "Transferências" before, and two identical rows in the same
            section looked like a bug (owner report 2026-08-14). */}
        <SettingsRow
          icon="cloud-check"
          label={t("native.settings.hub.rowDownloadSettings")}
          onPress={() => router.push("/(main)/settings/downloads")}
        />
        <SettingsRow
          icon="cast"
          label={t("native.settings.hub.rowDevices")}
          onPress={() => router.push("/(main)/settings/devices")}
        />
        <SettingsRow
          icon="circle-check"
          label={t("native.settings.hub.rowPasskeys")}
          onPress={() => router.push("/(main)/settings/passkeys")}
        />
      </SettingsSection>

      <SettingsSection title={t("native.settings.hub.theme")}>
        <SegmentedRow options={THEME_MODES} labels={themeLabels} value={mode} onChange={setMode} />
      </SettingsSection>

      <SettingsSection title={t("native.settings.hub.language")}>
        <SegmentedRow
          options={LOCALES}
          labels={languageLabels}
          value={locale}
          onChange={setLocale}
        />
      </SettingsSection>
    </ScrollView>
  );
}
