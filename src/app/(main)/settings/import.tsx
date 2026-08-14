import React from "react";
import Screen from "@/features/import";
import { SettingsRouteShell } from "@/features/settings/split";

export default function ImportSettingsRoute() {
  return (
    <SettingsRouteShell section="import">
      <Screen />
    </SettingsRouteShell>
  );
}
