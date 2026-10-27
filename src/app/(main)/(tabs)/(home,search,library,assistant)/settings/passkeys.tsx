import React from "react";
import Screen from "@/features/passkeys";
import { SettingsRouteShell } from "@/features/settings/split";

export default function PasskeysSettingsRoute() {
  return (
    <SettingsRouteShell section="passkeys">
      <Screen />
    </SettingsRouteShell>
  );
}
