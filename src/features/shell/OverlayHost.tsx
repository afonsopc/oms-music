/**
 * Overlay host (FR-16 shell): floats above every (main) screen. Renders the
 * MiniPlayer pill, the controller strip slot attached above it (WP9), or the
 * JamBar slot replacing the pill entirely while following a jam (WP10).
 *
 * MUDOU DE CASA em 2026-08-15: era irmao do Stack no (main)/_layout, passou a
 * ser irmao do Stack de CADA tab ((tabs)/(home,search,library)/_layout). A
 * razao e a barra do sistema: com native tabs a altura dela so e observavel
 * de DENTRO do ecra da tab (no iOS o UITabBarController injecta-a no safe
 * area do view controller filho; ver metrics.ts). Fica montado uma vez por
 * grupo, mas so o da tab focada e que esta visivel.
 *
 * Desktop shell (web >= 900px): the PILL alone disappears - the transport
 * bar is a grid row of the shell, so a floating duplicate would sit right on
 * top of it. The offline banner, the controller strip and the JamBar keep
 * floating (now just above the main pane's bottom edge, metrics.ts gates the
 * offset), because none of them has a desktop tenant yet.
 */
import React from "react";
import { View } from "react-native";
import { useDesktopShell } from "@/ui/shellLayout";
import { MiniPlayer } from "./MiniPlayer";
import { OfflineBanner } from "./OfflineBanner";
import { useOverlayBottomOffset } from "./metrics";
import {
  getShellSlots,
  useOverlaySlotActive,
  useShellSlotsVersion,
  type OverlaySlot,
} from "./slots";

const SlotGate = ({ slot }: { slot: OverlaySlot }) => {
  const active = useOverlaySlotActive(slot);
  if (!active) return null;
  const Component = slot.Component;
  return <Component />;
};

const PillStack = ({ strip, showPill }: { strip: OverlaySlot | null; showPill: boolean }) => (
  <>
    {strip ? <SlotGate slot={strip} /> : null}
    {showPill ? <MiniPlayer /> : null}
  </>
);

/** While the jam slot reports active, the JamBar replaces the pill. */
const JamSwitch = ({
  jam,
  strip,
  showPill,
}: {
  jam: OverlaySlot;
  strip: OverlaySlot | null;
  showPill: boolean;
}) => {
  const following = useOverlaySlotActive(jam);
  if (following) {
    const JamBar = jam.Component;
    return <JamBar />;
  }
  return <PillStack strip={strip} showPill={showPill} />;
};

export const OverlayHost = () => {
  useShellSlotsVersion();
  const bottom = useOverlayBottomOffset();
  const desktop = useDesktopShell();
  const slots = getShellSlots();
  const showPill = !desktop;
  // The desktop shell renders the controller strip ATTACHED to its transport
  // card (DesktopShell.web.tsx), where it is flush and full width. Floating a
  // second copy over the main pane is what the owner reported as an enormous
  // gap on 2026-08-16, point 17.
  const strip = desktop ? null : slots.controllerStrip;

  return (
    <>
      <OfflineBanner />
      <View
        pointerEvents="box-none"
        style={{ position: "absolute", left: 8, right: 8, bottom }}
      >
        {slots.jamBar ? (
          <JamSwitch jam={slots.jamBar} strip={strip} showPill={showPill} />
        ) : (
          <PillStack strip={strip} showPill={showPill} />
        )}
      </View>
    </>
  );
};
