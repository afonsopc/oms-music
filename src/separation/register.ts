/**
 * Separation subsystem wiring, imported by boot/wireup.ts (WP12):
 *  1. installs the real SeparationService behind contracts/separation;
 *  2. registers the "separateVocals" song-menu slot (FR-74): visible only
 *     when stems are absent, disabled with a live elapsed label while a run
 *     is pending/processing, hidden for jam songs (jam songs are never
 *     separated - one of the three guards).
 *
 * Known gap: the slot should also disable while CONTROLLING another device
 * (DESIGN 8.7); the controller role lives in WP9's remote store, which has
 * no contract seam yet - wired up in integration (WP12).
 */
import { getSeparationService, setSeparationService } from "@/contracts/separation";
import {
  registerSongMenuSlot,
  type SongMenuItem,
  type SongMenuSlotHook,
} from "@/contracts/songMenu";
import { formatDuration } from "@/domain/format";
import { separationService } from "./service";

const useSeparateVocalsSlot: SongMenuSlotHook = (ctx) => {
  const song = ctx.song;
  const status = getSeparationService().useSeparationStatus(song.id);

  if (song.jam_song) return [];

  const stemsPresent = !!(song.vocals_fs_node_id && song.instrumental_fs_node_id);
  const running = status.phase === "pending" || status.phase === "processing";

  // Slot condition (frozen contract): only when stems absent. While a run
  // is active the item stays visible but disabled, relabelled with elapsed.
  if (stemsPresent && !running) return [];

  if (running) {
    const item: SongMenuItem = {
      id: "separate-vocals",
      labelKey: "native.settings.separation.processing",
      labelParams: { elapsed: formatDuration(status.elapsedSeconds ?? 0) },
      icon: "audio-waveform",
      disabled: true,
      onPress: () => {},
    };
    return [item];
  }

  const item: SongMenuItem = {
    id: "separate-vocals",
    labelKey: "components.music.Settings.SongsTable.EditSongDialog.generateStems",
    icon: "audio-waveform",
    onPress: () => {
      void getSeparationService()
        .triggerSeparation(song.id)
        .catch(() => {
          // Errors surface on the settings/cog surfaces; the menu item is
          // fire-and-forget (the shared poll shows the resulting state).
        });
    },
  };
  return [item];
};

let registered = false;

/** Idempotent; wireup calls it once at boot. */
export const registerSeparationService = (): void => {
  if (registered) return;
  registered = true;
  setSeparationService(separationService);
  registerSongMenuSlot("separateVocals", useSeparateVocalsSlot);
};

// Importing the module registers (wireup imports every register.ts).
registerSeparationService();
