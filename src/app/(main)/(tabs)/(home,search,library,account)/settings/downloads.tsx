import React from "react";
import Screen from "@/features/downloads/settings";
import { SettingsRouteShell } from "@/features/settings/split";

export default function DownloadsSettingsRoute() {
  return (
    <SettingsRouteShell section="downloads">
      <Screen />
    </SettingsRouteShell>
  );
}
