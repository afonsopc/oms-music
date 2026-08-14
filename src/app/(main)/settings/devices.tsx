import React from "react";
import Screen from "@/features/devices";
import { SettingsRouteShell } from "@/features/settings/split";

export default function DevicesSettingsRoute() {
  return (
    <SettingsRouteShell section="devices">
      <Screen />
    </SettingsRouteShell>
  );
}
