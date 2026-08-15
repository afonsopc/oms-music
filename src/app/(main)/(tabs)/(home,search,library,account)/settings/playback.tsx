import React from "react";
import Screen from "@/features/settings/playback";
import { SettingsRouteShell } from "@/features/settings/split";

export default function PlaybackSettingsRoute() {
  return (
    <SettingsRouteShell section="playback">
      <Screen />
    </SettingsRouteShell>
  );
}
