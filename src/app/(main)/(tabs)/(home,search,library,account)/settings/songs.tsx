import React from "react";
import Screen from "@/features/settings/songs";
import { SettingsRouteShell } from "@/features/settings/split";

export default function SongsSettingsRoute() {
  return (
    <SettingsRouteShell section="songs">
      <Screen />
    </SettingsRouteShell>
  );
}
