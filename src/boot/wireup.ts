/**
 * Boot wiring (WP12). The single composition root: every subsystem's
 * register.ts is imported here and nowhere else, so `src/app/_layout.tsx`
 * needs exactly one side-effect import and no package has to reach into
 * another's internals.
 *
 * Registration order mirrors the dependency graph and the DESIGN 2 provider
 * stack (ThemeProvider > I18nProvider > QueryClientProvider > SessionGate >
 * DownloadStatusProvider > gesture root):
 *
 *  1. player engine     - creates the AudioPlayer, installs the BASE transport
 *                         (contracts/transport), configures the audio session.
 *  2. downloads         - LocalFileIndex, download status reader, offline
 *                         resolvers, the DownloadStatusProvider shell provider
 *                         (registered first, therefore OUTERMOST, matching
 *                         DESIGN 2) and the "download" song-menu slot. This one
 *                         self-registers on import, before this module's body.
 *  3. separation        - the SeparationService + "separateVocals" slot (also
 *                         self-registering on import).
 *  4. remote playback   - the transport DECORATOR on top of the engine base,
 *                         the PlaybackChannel, the cast button and controller
 *                         strip shell slots. Must run after 1 (it decorates the
 *                         engine transport and reads the engine singleton).
 *  5. jam + social      - follower player, jam channel, proposal interceptor,
 *                         JamBar overlay, friends strip, friends/notifications
 *                         channels. Must run after 4 (jam rides the remote
 *                         PlaybackChannel to steal the active device).
 *  6. shell hosts       - AddToPlaylist dialog host and the notice host, in
 *                         that order (both are pass-through providers).
 *  7. song-menu slots   - the core slots (WP5/WP6 surfaces) and Start radio;
 *                         download / separateVocals / proposeToJam came with
 *                         their subsystems above.
 *
 * Every registrar is idempotent, so a Fast Refresh re-import is harmless.
 * In development the boot logs a seam table so a missing registration is
 * visible in the first seconds of a dev build (WORKPLAN WP12.1).
 */
// Side-effect registrations that run during the import phase, before this
// module's body: downloads FIRST so its provider is the outermost one.
import "@/downloads/register";
import "@/separation/register";
// Predictive prefetch installs its platform host over the downloads manager,
// so it imports AFTER downloads. No React, no provider, no slot: it only
// binds the driver's seams (see prefetch/driver.ts).
import "@/prefetch/register";

import {
  getRegisteredSongMenuSlots,
  getSongMenuSlot,
  registerSongMenuSlot,
  SONG_MENU_SLOT_ORDER,
  type SongMenuSlotHook,
} from "@/contracts/songMenu";
import { registerLastUserMemo } from "@/auth/lastUser";
import { getStemMixer } from "@/contracts/stemMixer";
import { getStemFileProvider } from "@/contracts/stemFiles";
import { getTransport } from "@/contracts/transport";
import { DownloadStatusProvider } from "@/downloads/context";
import { stemFileProvider } from "@/downloads/stemProvision";
import { getDownloadsSurface } from "@/downloads/surface";
import { getShellSlots, registerShellProvider } from "@/features/shell/slots";
import { registerDeviceSurfaces } from "@/features/devices/register";
import { registerCoreSongMenuSlots } from "@/features/home/register";
import { registerJamSurfaces } from "@/features/jam/register";
import { registerAddToPlaylistHost } from "@/features/playlists/register";
import { registerRadioSongMenuSlots } from "@/features/radios/register";
import { registerDesktopBridge } from "@/desktop/register";
import { isMiniplayerWindow } from "@/desktop/miniplayer";
import { registerLibraryWarmup } from "@/api/warmup";
import { getJamManager } from "@/jam/channel";
import { registerPlayerEngine } from "@/player/register";
import { getPlaybackChannel } from "@/remote/channel";
import { useRemoteStore, type RemoteStoreState } from "@/remote/store";
import { NoticeHost, registerNoticeHandlers } from "./notices";

// Captured BEFORE anything in this module's body runs: the inert transport
// installed by contracts/transport. Nothing registers a transport at import
// time, so a later identity change proves the engine (and then the remote
// decorator) took over.
const inertTransport = getTransport();

/**
 * Same trick for the custom-blend mixer (contracts/stemMixer). player/register
 * installs the native bridge inside `registerPlayerEngine()`, which runs in
 * this module's BODY, so the value captured here is still the inert default
 * and a later identity change proves the real one took over. The check is
 * about the WIRING, not about the binary: a build with no native mixer
 * installs a bridge that honestly reports `isAvailable() === false`, and the
 * report says so on the same row.
 */
const inertStemMixer = getStemMixer();

/**
 * Separation is disabled on a controller (DESIGN 8.7): the run would land on
 * the wrong device's playback. The slot itself belongs to WP11, which cannot
 * import the remote store (protocol layers are below features); integration
 * wraps the registered hook instead of duplicating it.
 */
const selectIsController = (s: RemoteStoreState): boolean => s.role === "controller";

/** WP11's slot, captured at boot; never null while the wrapper is registered. */
let innerSeparationSlot: SongMenuSlotHook = () => [];

/**
 * Both calls are hooks and both run unconditionally: the renderer isolates
 * every slot in its own component (ui/SongMenu), so this stays legal and
 * reactive if the role flips while the sheet is open.
 */
const useGatedSeparationSlot: SongMenuSlotHook = (ctx) => {
  const items = innerSeparationSlot(ctx);
  const controlling = useRemoteStore(selectIsController);
  if (!controlling) return items;
  return items.map((item) => ({ ...item, disabled: true, onPress: () => {} }));
};

const gateSeparationSlotOnController = (): void => {
  const inner = getSongMenuSlot("separateVocals");
  if (!inner || inner === useGatedSeparationSlot) return;
  innerSeparationSlot = inner;
  registerSongMenuSlot("separateVocals", useGatedSeparationSlot);
};

let wired = false;

/** Idempotent; the root layout imports this module for its side effect. */
export const wireUp = (): void => {
  if (wired) return;
  // A janela do mini-player corre o mesmo bundle e NAO quer nada disto: um
  // segundo motor de audio, uma segunda sessao de cache local e um segundo
  // canal de presenca no mesmo processo seriam trabalho a disputar recursos
  // para desenhar tres botoes. Ela e um espelho por eventos
  // (features/miniplayer) e mais nada.
  if (isMiniplayerWindow()) {
    wired = true;
    return;
  }
  wired = true;

  // 0a. The last-user memo, before ANYTHING reads it. The persisted query
  // cache (api/persistCache), the downloads manager and the desktop cache
  // session all key on it, and until this call existed it was written only
  // below downloads/register's web early-return - so on web and on the
  // desktop shell it was never written at all and the whole disk-persisted
  // query cache was silently dead.
  registerLastUserMemo();

  // 0b. Notice handlers, so anything the registrations below emit (a jam
  // resumed on boot, a repair pass refusal) reaches the user instead of the
  // console. The host component itself joins the provider stack in step 6.
  registerNoticeHandlers();

  // 1. Player engine: base transport + audio session + lock screen feed.
  registerPlayerEngine();

  // 2/3. downloads + separation already registered on import (see header).

  // 4. Remote playback: transport decorator, PlaybackChannel, shell slots.
  registerDeviceSurfaces();

  // 5. Jam + social: follower, interceptor, JamBar, friends strip.
  registerJamSurfaces();

  // 6. Shell hosts. DownloadStatusProvider is already first in the provider
  // list (import-time registration), so these land inside it.
  registerAddToPlaylistHost();
  registerShellProvider(NoticeHost);

  // 7. Song-menu slots owned by feature packages.
  registerCoreSongMenuSlots();
  registerRadioSongMenuSlots();
  gateSeparationSlotOnController();

  // 8. Local-first warm-up: after sign-in, sweep the library into the query
  // cache (and its disk snapshot) so taps land on local data.
  registerLibraryWarmup();

  // 9. Desktop shell bridge (plano "uma so app" F5): media keys, Now
  // Playing/MPRIS and the tray, fed from the player store and routed back
  // through the transport seam. Probes for the Tauri global itself, so on
  // native and plain web this is a no-op. After 1 and 4 on purpose: its
  // commands ride the same decorated transport the lock screen uses.
  registerDesktopBridge();

  if (__DEV__) logSeamReport();
};

// ---------------------------------------------------------------------------
// Dev-only seam verification (WORKPLAN WP12.1: "verify each seam has its real
// implementation at boot in dev (assert + log)").
// ---------------------------------------------------------------------------

export interface SeamCheck {
  seam: string;
  ok: boolean;
  detail: string;
}

/**
 * Pure-ish snapshot of the wiring, exported so a dev screen (or a device
 * checklist run) can read the same table the boot log prints.
 */
export const seamReport = (): SeamCheck[] => {
  const slots = getShellSlots();
  const menu = getRegisteredSongMenuSlots();
  // Slots with no owner package are rendered by ui/SongMenu itself
  // (viewCredits) or injected by the surface (surfaceExtras).
  const missingMenuSlots = SONG_MENU_SLOT_ORDER.filter(
    (id) => id !== "viewCredits" && id !== "surfaceExtras" && !menu.has(id),
  );

  return [
    {
      seam: "transport (engine base + remote decorator)",
      ok: getTransport() !== inertTransport,
      detail: "contracts/transport",
    },
    {
      // registerDownloads installs the local file index, the status reader,
      // the offline resolvers, the provider and the menu slot in ONE call, so
      // the slot and the provider prove the whole set.
      seam: "downloads (localSource, status, offline resolvers)",
      ok: menu.has("download") && slots.providers.includes(DownloadStatusProvider),
      detail: "downloads/register",
    },
    {
      seam: "downloadStatusProvider (outermost shell provider)",
      ok: slots.providers[0] === DownloadStatusProvider,
      detail: "downloads/context via features/shell/slots",
    },
    {
      // Same pattern: registerSeparationService installs the service and the
      // slot together.
      seam: "separationService",
      ok: menu.has("separateVocals"),
      detail: "contracts/separation + separation/register",
    },
    {
      // The mixer that makes `custom` audible. Two independent facts: the
      // seam is wired (identity moved off the inert default) and whether this
      // binary actually carries the native module.
      seam: "stemMixer (custom blend audio)",
      ok: getStemMixer() !== inertStemMixer,
      detail: getStemMixer().isAvailable()
        ? "player/register + oms-native OmsStemMixer"
        : "player/register (no native mixer in this binary)",
    },
    {
      // The mixer plays local files only, so the blend needs both stems on
      // disk; without this the seam answers from the local index alone and
      // never fetches.
      seam: "stemFileProvider (stems on disk before the blend)",
      ok: getStemFileProvider() === stemFileProvider,
      detail: "downloads/stemProvision via downloads/register",
    },
    {
      seam: "playbackChannel (presence, roles, snapshots)",
      ok: getPlaybackChannel() !== null,
      detail: "remote/register",
    },
    {
      seam: "castButton + controllerStrip",
      ok: slots.castButton !== null && slots.controllerStrip !== null,
      detail: "features/devices/register",
    },
    {
      seam: "jam (manager, interceptor, JamBar, friends strip)",
      ok: getJamManager() !== null && slots.jamBar !== null,
      detail: "features/jam/register",
    },
    {
      seam: "song menu slots",
      ok: missingMenuSlots.length === 0,
      detail:
        missingMenuSlots.length === 0
          ? `${menu.size} registered`
          : `missing: ${missingMenuSlots.join(", ")}`,
    },
    {
      // The local store, and with it the predictive prefetch driver's host:
      // both are installed by the same registrar on each platform (native
      // downloads/register + prefetch/register, desktop downloads/desktop).
      //
      // Always `ok`, because "no local store" is the CORRECT state in a plain
      // browser tab - it streams, and a predictive tier would have nothing to
      // prefetch into. The detail is what carries the information.
      seam: "downloadsSurface + prefetch (policy driver host)",
      ok: true,
      detail: getDownloadsSurface().available()
        ? "manager-backed (native) or Rust-backed (Tauri shell)"
        : "inert default (plain web: streams, no predictive tier)",
    },
    {
      seam: "notice host (player/downloads/jam/remote messages)",
      ok: slots.providers.includes(NoticeHost),
      detail: "boot/notices",
    },
  ];
};

const logSeamReport = (): void => {
  const report = seamReport();
  const broken = report.filter((r) => !r.ok);
  for (const row of report) {
    const mark = row.ok ? "ok  " : "MISS";
    console.log(`[boot] ${mark} ${row.seam} (${row.detail})`);
  }
  if (broken.length > 0) {
    console.warn(
      `[boot] ${broken.length} seam(s) missing a real implementation: ${broken
        .map((r) => r.seam)
        .join(", ")}`,
    );
  }
};

wireUp();
