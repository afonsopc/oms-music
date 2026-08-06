/**
 * Download settings (FR-93, route 28): wifiOnly (default off, enforced at
 * ENQUEUE time - FR-88), includeStems (default on, ~2x storage note) and
 * showOnlyDownloaded, the global filter the collection screens consume
 * through the offline-collections context (they filter to `done` rows and
 * suppress reorder while it is on).
 *
 * Settings persist in kv-store and are read synchronously by the manager, so
 * a flip takes effect on the very next enqueue.
 */
import React, { useEffect, useState } from "react";
import { ScrollView, Switch, Text, View } from "react-native";
import { storageUsage } from "@/downloads/manager";
import { updateDownloadSettings, useDownloadSettings } from "@/downloads/settings";
import { useContentBottomPadding } from "@/features/shell/metrics";
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
  const settings = useDownloadSettings();
  const [usage, setUsage] = useState<{ bytes: number; files: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void storageUsage()
      .then((result) => {
        if (!cancelled) setUsage(result);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: tokens.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: bottomPadding, gap: 16 }}
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

      <Text style={{ color: tokens.mutedForeground, fontSize: 13 }}>
        {usage
          ? t("native.downloads.storageUsed", { size: formatBytes(usage.bytes) })
          : t("native.common.loading")}
      </Text>
    </ScrollView>
  );
}
