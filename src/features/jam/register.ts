/**
 * Jam + social shell registrations (imported by boot/wireup.ts, WP12).
 *
 * Kept out of src/jam and src/social because the protocol layers must never
 * import from src/features (DESIGN 1 import direction) - the same split
 * features/devices/register.ts uses for WP9.
 *
 * Registers:
 *  - the JamBar overlay, which REPLACES the MiniPlayer pill while following
 *    a jam (features/shell/slots);
 *  - the Home friends listening strip content (features/home/friendsSlot);
 *  - the "Propose to the jam" song-menu slot (contracts/songMenu, FR-74),
 *    visible only while following a jam whose queue_mode is "everyone";
 *  - the jam and social subsystems themselves, so wireup importing this file
 *    gets a consistent app. Every entry point is idempotent.
 */
import { registerSongMenuSlot, type SongMenuSlotHook } from "@/contracts/songMenu";
import { registerFriendsStrip } from "@/features/home/friendsSlot";
import { registerJamBarOverlay } from "@/features/shell/slots";
import { friendsStripSlot } from "@/features/friends/strip";
import { jamPropose } from "@/jam/channel";
import { registerJam } from "@/jam/register";
import { selectCanPropose, useJamStore } from "@/jam/store";
import { registerSocial } from "@/social/register";
import { jamBarSlot } from "./JamBar";

/**
 * Propose slot (FR-117). Hidden unless we are FOLLOWING a jam that accepts
 * proposals; hidden for jam-injected rows, which are the host's queue and
 * cannot be proposed back. Members may only propose their OWN songs, which
 * is exactly what a member's library contains.
 */
const useProposeToJamSlot: SongMenuSlotHook = (ctx) => {
  const canPropose = useJamStore(selectCanPropose);
  if (!canPropose || ctx.song.jam_song) return [];
  return [
    {
      id: "proposeToJam",
      labelKey: "components.music.SongCard.proposeToJam",
      icon: "radio",
      onPress: () => void jamPropose(ctx.song.id),
    },
  ];
};

let registered = false;

export const registerJamSurfaces = (): void => {
  if (registered) return;
  registered = true;
  registerJam();
  registerSocial();
  registerJamBarOverlay(jamBarSlot);
  registerFriendsStrip(friendsStripSlot);
  registerSongMenuSlot("proposeToJam", useProposeToJamSlot);
};
