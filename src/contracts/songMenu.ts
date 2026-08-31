/**
 * Canonical song menu contract (DESIGN.md 13.5, FR-74). This file FIXES the
 * full slot order and visibility conditions; `ui/SongMenu.tsx` (WP4) renders
 * the registry so the menu is byte-identical on every surface. Packages
 * register implementations for their slots (WP8 download, WP10 propose,
 * WP11 separate); unregistered slots render nothing.
 *
 * Slot implementations are React hooks (they may subscribe to stores); the
 * renderer MUST isolate each slot in its own component so the rules of hooks
 * hold when registrations land at boot.
 */
import type { Song } from "@/domain/song";

/** Frozen order (FR-74). Items render grouped in exactly this sequence. */
export const SONG_MENU_SLOT_ORDER = [
  "playPause",
  "likeToggle",
  "playNext",
  "addToQueue",
  "openAlbum",
  "openArtist",
  "viewCredits", // only when song.artists is non-empty
  "addToPlaylist",
  "surfaceExtras", // items injected by the surface (e.g. Remove from playlist)
  "startRadio", // P1
  "karaoke", // modo de palco karaoke; disabled com hint quando não há stems
  "proposeToJam", // P1; only while following a jam with queue_mode "everyone"
  "separateVocals", // P1; only when stems absent; disabled with elapsed while processing
  "download", // Download / "Downloading N%" (disabled) / Remove download
  "exportFiles", // exportar música/original/stems para fora da app (dono, 2026-08-16)
  "fixMatch", // "esta música está errada": trocar a fonte da faixa (2026-08-31)
] as const;

export type SongMenuSlotId = (typeof SONG_MENU_SLOT_ORDER)[number];

/** Where the menu was opened from; lets slots adapt conditions. */
export interface SongMenuContext {
  song: Song;
  surface:
    | "row"
    | "player"
    | "miniPlayer"
    | "nowPlaying"
    | "queue"
    | "search"
    | (string & {});
  /** Extra items injected by the surface, rendered in the surfaceExtras slot. */
  surfaceExtras?: SongMenuItem[];
  /** Row play handler; when absent the item toggles the current song. */
  onPlay?: () => void;
}

export interface SongMenuItem {
  id: string;
  /** i18n key resolved through t(); all menu copy goes through the catalog. */
  labelKey: string;
  labelParams?: Record<string, string | number>;
  /** Icon name hint for the renderer (WP4 maps to its icon set). */
  icon?: string;
  disabled?: boolean;
  destructive?: boolean;
  onPress: () => void;
}

/**
 * A slot implementation is a React hook: given the context it returns the
 * items to render for that slot (empty array = nothing).
 */
export type SongMenuSlotHook = (ctx: SongMenuContext) => SongMenuItem[];

const registry = new Map<SongMenuSlotId, SongMenuSlotHook>();

export const registerSongMenuSlot = (id: SongMenuSlotId, hook: SongMenuSlotHook): void => {
  registry.set(id, hook);
};

export const getSongMenuSlot = (id: SongMenuSlotId): SongMenuSlotHook | undefined =>
  registry.get(id);

export const getRegisteredSongMenuSlots = (): ReadonlyMap<SongMenuSlotId, SongMenuSlotHook> =>
  registry;
