/**
 * Settings hub (FR-95): Import / Songs / Artists / Playback plus the
 * Downloads and Devices entries, and the app prefs inline - theme
 * light/dark/system (FR-18 UI) and language en/pt/lv (FR-19 UI). Screen
 * bodies live in their own files; this screen only navigates.
 *
 * Redesenho 2026-11-04: uma só moldura (SettingsPage), linhas sem caixa, e o
 * tema e o idioma como linhas simples com um visto na escolhida (eram
 * botões em pílula).
 */
import React from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { LOCALES, setLocale, useLocale, useT, type Locale } from "@/i18n";
import { useTheme, type ThemeMode } from "@/theme/provider";
import { useDesktopShell } from "@/ui";
import { AndroidDownload } from "@/features/android/download";
import { AppVersion } from "./version";
import { CheckRow, SettingsPage, SettingsRow, SettingsSection } from "./ui";

const THEME_MODES: readonly ThemeMode[] = ["system", "dark", "light"];

const THEME_LABEL_KEYS: Record<ThemeMode, string> = {
  light: "native.settings.hub.themeLight",
  dark: "native.settings.hub.themeDark",
  system: "native.settings.hub.themeSystem",
};

const LANGUAGE_LABEL_KEYS: Record<Locale, string> = {
  en: "native.settings.hub.languageEn",
  pt: "native.settings.hub.languagePt",
  lv: "native.settings.hub.languageLv",
};

/** Tema e idioma: iguais no telemóvel e no computador. */
const Preferences = () => {
  const t = useT();
  const { mode, setMode } = useTheme();
  const locale = useLocale();
  return (
    <View style={{ gap: 28 }}>
      <SettingsSection title={t("native.settings.hub.theme")}>
        {THEME_MODES.map((option, index) => (
          <CheckRow
            key={option}
            first={index === 0}
            label={t(THEME_LABEL_KEYS[option])}
            selected={option === mode}
            onPress={() => setMode(option)}
          />
        ))}
      </SettingsSection>
      <SettingsSection title={t("native.settings.hub.language")}>
        {LOCALES.map((option, index) => (
          <CheckRow
            key={option}
            first={index === 0}
            label={t(LANGUAGE_LABEL_KEYS[option])}
            selected={option === locale}
            onPress={() => setLocale(option)}
          />
        ))}
      </SettingsSection>
    </View>
  );
};

export default function SettingsHubScreen() {
  const t = useT();
  const router = useRouter();
  // Desktop (plan 4.3, settings row): the split shell already lists every
  // section on the left, so this screen becomes the "General" DETAIL only -
  // theme and language, no duplicate navigation rows. Mobile keeps the hub.
  const desktop = useDesktopShell();

  if (desktop) {
    return (
      <SettingsPage title={t("native.desktop.settingsGeneral")}>
        <Preferences />
        <AndroidDownload quiet />
        <AppVersion />
      </SettingsPage>
    );
  }

  return (
    <SettingsPage title={t("native.settings.hub.title")}>
      <SettingsSection title={t("native.settings.hub.sectionLibrary")}>
        <SettingsRow
          first
          icon="download"
          label={t("components.music.Settings.import")}
          detail={t("components.music.Settings.ImportPage.description")}
          onPress={() => router.push("/settings/import")}
        />
        <SettingsRow
          icon="music"
          label={t("components.music.Settings.songs")}
          detail={t("components.music.Settings.SongsPage.description")}
          onPress={() => router.push("/settings/songs")}
        />
        <SettingsRow
          icon="user"
          label={t("components.music.Settings.artists")}
          detail={t("components.music.Settings.ArtistsPage.description")}
          onPress={() => router.push("/settings/artists")}
        />
      </SettingsSection>

      <SettingsSection title={t("native.settings.hub.sectionPlayback")}>
        <SettingsRow
          first
          icon="audio-waveform"
          label={t("components.music.Settings.PlaybackPage.title")}
          detail={t("components.music.Settings.PlaybackPage.subtitle")}
          onPress={() => router.push("/settings/playback")}
        />
        <SettingsRow
          icon="download"
          label={t("native.shell.tabDownloads")}
          detail={t("native.downloadsOverview.rowDetail")}
          onPress={() => router.push("/settings/downloads-overview")}
        />
        {/* Distinct label from the downloads OVERVIEW row above: both read
            "Transferências" before, and two identical rows in the same
            section looked broken (owner report 2026-08-14). */}
        <SettingsRow
          icon="cloud-check"
          label={t("native.settings.hub.rowDownloadSettings")}
          onPress={() => router.push("/settings/downloads")}
        />
        <SettingsRow
          icon="cast"
          label={t("native.settings.hub.rowDevices")}
          onPress={() => router.push("/settings/devices")}
        />
      </SettingsSection>

      <Preferences />
      <AndroidDownload quiet />
      <AppVersion />
    </SettingsPage>
  );
}
