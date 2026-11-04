/**
 * Download settings (FR-93, route 28): wifiOnly (default off, enforced at
 * ENQUEUE time - FR-88), includeStems (default on, ~2x storage note) and
 * showOnlyDownloaded, the global filter the collection screens consume
 * through the offline-collections context (they filter to `done` rows and
 * suppress reorder while it is on).
 *
 * Plus, since 2026-08-14, the predictive tier: `predictiveEnabled` (the master
 * switch for downloading ahead of the tap) and `predictiveWifiOnly`. That
 * second one shipped defaulting ON, to keep a wrong guess off cellular; the
 * owner asked for it OFF on 2026-08-16, because restricted to WiFi the head
 * start almost never runs on a phone and the whole tier was idle. `wifiOnly`
 * still covers the cautious case - the gate reads
 * `wifiOnly || predictiveWifiOnly`.
 *
 * Settings persist in kv-store and are read synchronously by the manager, so
 * a flip takes effect on the very next enqueue.
 */
import React, { useEffect, useState } from "react";
import { Text } from "react-native";
import { getDownloadsSurface } from "@/downloads/surface";
import { updateDownloadSettings, useDownloadSettings } from "@/downloads/settings";
import { SettingsPage, SettingsSection, SwitchRow } from "@/features/settings/ui";
import { useT } from "@/i18n";
import { useTheme } from "@/theme/provider";
import { formatBytes } from "./format";

export default function DownloadSettingsScreen() {
  const t = useT();
  const { tokens } = useTheme();
  const settings = useDownloadSettings();
  const [usage, setUsage] = useState<{ bytes: number; files: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    // The REAL walk, and the only one in this design: async, off the render
    // path, and named so it can never be mistaken for the cheap SQL sums.
    void getDownloadsSurface()
      .storageUsageSlow()
      .then((result) => {
        if (!cancelled) setUsage(result);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // The cache row (size, budget and "Limpar") used to live here TOO, which
  // is the duplication the owner reported on 2026-08-16, point 10: both
  // download screens carried it. It belongs to the overview, next to the
  // storage bar; this screen is switches. One concept, one place.
  //
  // Redesenho 2026-11-04: as linhas são as SwitchRow comuns (a cópia em
  // caixa que vivia aqui saiu) e o adiantar fica em "Avançado".

  return (
    <SettingsPage title={t("native.downloads.settingsTitle")}>
      <SettingsSection>
        <SwitchRow
          first
          label={t("native.downloads.wifiOnlyTitle")}
          detail={t("native.downloads.wifiOnlyDetail")}
          value={settings.wifiOnly}
          onValueChange={(value) => updateDownloadSettings({ wifiOnly: value })}
        />
        <SwitchRow
          label={t("native.downloads.onlyDownloadedTitle")}
          detail={t("native.downloads.onlyDownloadedDetail")}
          value={settings.showOnlyDownloaded}
          onValueChange={(value) => updateDownloadSettings({ showOnlyDownloaded: value })}
        />
      </SettingsSection>

      {/* The predictive tier and the stems: a different promise (nothing
          predicted ever joins the offline library) and rarely touched, so
          they sit under "Avançado". The predictive rows are hidden where
          there is no local store to predict INTO (a plain browser tab). */}
      <SettingsSection title={t("native.settings.advanced")}>
        <SwitchRow
          first
          label={t("native.downloads.includeStemsTitle")}
          detail={t("native.downloads.includeStemsDetail")}
          value={settings.includeStems}
          onValueChange={(value) => updateDownloadSettings({ includeStems: value })}
        />
        {getDownloadsSurface().available() ? (
          <>
            <SwitchRow
              label={t("native.downloads.predictiveTitle")}
              detail={t("native.downloads.predictiveDetail")}
              value={settings.predictiveEnabled}
              onValueChange={(value) => updateDownloadSettings({ predictiveEnabled: value })}
            />
            <SwitchRow
              label={t("native.downloads.predictiveWifiTitle")}
              detail={t("native.downloads.predictiveWifiDetail")}
              value={settings.predictiveWifiOnly}
              onValueChange={(value) => updateDownloadSettings({ predictiveWifiOnly: value })}
            />
          </>
        ) : null}
      </SettingsSection>

      <Text style={{ color: tokens.mutedForeground, fontSize: 14 }}>
        {usage
          ? t("native.downloads.storageUsed", { size: formatBytes(usage.bytes) })
          : t("native.common.loading")}
      </Text>
    </SettingsPage>
  );
}
