/**
 * Shell registrations for the remote-playback surfaces (imported by
 * boot/wireup.ts, WP12). Kept out of src/remote because the protocol layer
 * must never import from src/features (DESIGN 1 import direction).
 *
 * Registers:
 *  - the cast button rendered inside the MiniPlayer pill (FR-16 slot);
 *  - the emerald controller strip overlay, active while another device owns
 *    audio (FR-109 / FR-16 shell).
 *
 * It also starts the remote subsystem itself, so wireup importing either
 * register.ts gets a consistent app; both entry points are idempotent.
 */
import { registerCastButton, registerControllerStripOverlay } from "@/features/shell/slots";
import { registerRemotePlayback } from "@/remote/register";
import { CastButton, controllerStripSlot } from "./DevicePicker";

let registered = false;

export const registerDeviceSurfaces = (): void => {
  if (registered) return;
  registered = true;
  registerRemotePlayback();
  registerCastButton(CastButton);
  registerControllerStripOverlay(controllerStripSlot);
};
