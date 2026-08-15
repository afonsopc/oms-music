import React from "react";
import Screen from "@/features/downloads/overview";
import { SettingsRouteShell } from "@/features/settings/split";

export default function DownloadsOverviewSettingsRoute() {
  return (
    <SettingsRouteShell section="downloads-overview">
      <Screen />
    </SettingsRouteShell>
  );
}
