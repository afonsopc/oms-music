/**
 * Overlay host (FR-16 shell): floats above every (main) screen. Renders the
 * MiniPlayer pill, the controller strip slot attached above it (WP9), or the
 * JamBar slot replacing the pill entirely while following a jam (WP10).
 * Mounted once in (main)/_layout, as a sibling of the Stack.
 */
import React from "react";
import { View } from "react-native";
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

const PillStack = ({ strip }: { strip: OverlaySlot | null }) => (
  <>
    {strip ? <SlotGate slot={strip} /> : null}
    <MiniPlayer />
  </>
);

/** While the jam slot reports active, the JamBar replaces the pill. */
const JamSwitch = ({ jam, strip }: { jam: OverlaySlot; strip: OverlaySlot | null }) => {
  const following = useOverlaySlotActive(jam);
  if (following) {
    const JamBar = jam.Component;
    return <JamBar />;
  }
  return <PillStack strip={strip} />;
};

export const OverlayHost = () => {
  useShellSlotsVersion();
  const bottom = useOverlayBottomOffset();
  const slots = getShellSlots();

  return (
    <>
      <OfflineBanner />
      <View
        pointerEvents="box-none"
        style={{ position: "absolute", left: 8, right: 8, bottom }}
      >
        {slots.jamBar ? (
          <JamSwitch jam={slots.jamBar} strip={slots.controllerStrip} />
        ) : (
          <PillStack strip={slots.controllerStrip} />
        )}
      </View>
    </>
  );
};
