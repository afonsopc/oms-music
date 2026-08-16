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
import { ScrollView, Switch, Text, View } from "react-native";
import { getDownloadsSurface } from "@/downloads/surface";
import { updateDownloadSettings, useDownloadSettings } from "@/downloads/settings";
import { useContentBottomPadding, useContentTopPadding } from "@/features/shell/metrics";
import { useT } from "@/i18n";
import { switchColors } from "@/theme/switchColors";
import { useTheme } from "@/theme/provider";
import { RADIUS } from "@/theme/tokens";
import { formatBytes } from "./format";

const SettingsCard = ({ children }: { children: React.ReactNode }) => {
  const { tokens } = useTheme();
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: tokens.border,
        borderRadius: RADIUS * 2,
        backgroundColor: tokens.card,
        overflow: "hidden",
      }}
    >
      {children}
    </View>
  );
};

const ToggleRow = ({
  label,
  detail,
  value,
  onValueChange,
  first = false,
}: {
  label: string;
  detail?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  first?: boolean;
}) => {
  const { tokens } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: tokens.border,
      }}
    >
      {/* minWidth 0 keeps the long detail line inside the card. */}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={{ color: tokens.foreground, fontSize: 15 }}>{label}</Text>
        {detail ? (
          <Text style={{ color: tokens.mutedForeground, fontSize: 12, lineHeight: 17 }}>
            {detail}
          </Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        {...switchColors(tokens)}
      />
    </View>
  );
};

export default function DownloadSettingsScreen() {
  const t = useT();
  const { tokens } = useTheme();
  const bottomPadding = useContentBottomPadding();
  const topPadding = useContentTopPadding();
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

  // The cache row (size, budget and "Limpar cache") used to live here TOO,
  // which is the duplication the owner reported on 2026-08-16, point 10:
  // both download screens carried it. It belongs to the overview, next to
  // the storage bar and the waste ratio that give the number its meaning;
  // this screen is switches. One concept, one place.

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: tokens.background }}
      contentContainerStyle={{ padding: 16, paddingTop: topPadding, paddingBottom: bottomPadding, gap: 16 }}
    >
      <Text style={{ color: tokens.foreground, fontSize: 28, fontWeight: "800" }}>
        {t("native.downloads.settingsTitle")}
      </Text>

      <SettingsCard>
        <ToggleRow
          first
          label={t("native.downloads.wifiOnlyTitle")}
          detail={t("native.downloads.wifiOnlyDetail")}
          value={settings.wifiOnly}
          onValueChange={(value) => updateDownloadSettings({ wifiOnly: value })}
        />
        <ToggleRow
          label={t("native.downloads.includeStemsTitle")}
          detail={t("native.downloads.includeStemsDetail")}
          value={settings.includeStems}
          onValueChange={(value) => updateDownloadSettings({ includeStems: value })}
        />
        <ToggleRow
          label={t("native.downloads.onlyDownloadedTitle")}
          detail={t("native.downloads.onlyDownloadedDetail")}
          value={settings.showOnlyDownloaded}
          onValueChange={(value) => updateDownloadSettings({ showOnlyDownloaded: value })}
        />
      </SettingsCard>

      {/* The predictive tier. Its own card because it is a different promise:
          nothing here ever joins the offline library, and everything here is
          deleted the moment the cache budget says so. The WiFi row is nested
          under the master switch by relevance, not by disabling it: a user who
          turns prediction off later should find their WiFi choice remembered.
          Hidden entirely where there is no local store to predict INTO: a
          plain browser tab streams, so the switches would promise nothing. */}
      {getDownloadsSurface().available() ? (
      <SettingsCard>
        <ToggleRow
          first
          label={t("native.downloads.predictiveTitle")}
          detail={t("native.downloads.predictiveDetail")}
          value={settings.predictiveEnabled}
          onValueChange={(value) => updateDownloadSettings({ predictiveEnabled: value })}
        />
        <ToggleRow
          label={t("native.downloads.predictiveWifiTitle")}
          detail={t("native.downloads.predictiveWifiDetail")}
          value={settings.predictiveWifiOnly}
          onValueChange={(value) => updateDownloadSettings({ predictiveWifiOnly: value })}
        />
      </SettingsCard>
      ) : null}

      <Text style={{ color: tokens.mutedForeground, fontSize: 13 }}>
        {usage
          ? t("native.downloads.storageUsed", { size: formatBytes(usage.bytes) })
          : t("native.common.loading")}
      </Text>
    </ScrollView>
  );
}
