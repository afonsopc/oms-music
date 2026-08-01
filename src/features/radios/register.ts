/**
 * WP6's song-menu slot: "Start radio" (FR-123, FR-74 slot `startRadio`).
 *
 * The canonical menu order and the renderer live in contracts/songMenu +
 * ui/SongMenu; this file only fills the one slot WP6 owns. Slot
 * implementations are React hooks, so this one stays hook-free and returns
 * its items unconditionally except for jam-injected entries, whose ids
 * belong to another user's library and would only 404 the radio builder.
 *
 * Idempotent; boot/wireup.ts (WP12) calls `registerRadioSongMenuSlots()`.
 */
import { router } from "expo-router";
import { registerSongMenuSlot, type SongMenuSlotHook } from "@/contracts/songMenu";
import { songRadioRoute } from "@/lib/routes";

const useStartRadioSlot: SongMenuSlotHook = (ctx) => {
  if (ctx.song.jam_song) return [];
  return [
    {
      id: "startRadio",
      labelKey: "components.music.SongCard.startRadio",
      icon: "radio",
      onPress: () => router.push(songRadioRoute(Number(ctx.song.id))),
    },
  ];
};

let registered = false;

export const registerRadioSongMenuSlots = (): void => {
  if (registered) return;
  registered = true;
  registerSongMenuSlot("startRadio", useStartRadioSlot);
};
