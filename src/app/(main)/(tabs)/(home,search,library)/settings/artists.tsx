import React from "react";
import Screen from "@/features/settings/artists";
import { SettingsRouteShell } from "@/features/settings/split";

export default function ArtistsSettingsRoute() {
  return (
    <SettingsRouteShell section="artists">
      <Screen />
    </SettingsRouteShell>
  );
}
