import React from "react";
import SettingsHubScreen from "@/features/settings";
import { SettingsRouteShell } from "@/features/settings/split";

export default function SettingsIndexRoute() {
  return (
    <SettingsRouteShell section="general">
      <SettingsHubScreen />
    </SettingsRouteShell>
  );
}
