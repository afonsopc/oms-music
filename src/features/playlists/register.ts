/**
 * WP6 shell registration: the ONE AddToPlaylist dialog instance (FR-49).
 *
 * The `addToPlaylist` song-menu slot only opens a vanilla store
 * (`addToPlaylist.ts`); something has to render the dialog above the app or
 * the menu item does nothing. AddToPlaylistHost is a pass-through provider,
 * so it registers into the shell provider stack exactly like WP8's download
 * status provider.
 *
 * Idempotent; boot/wireup.ts (WP12) calls `registerAddToPlaylistHost()`.
 */
import { registerShellProvider } from "@/features/shell/slots";
import { AddToPlaylistHost } from "./AddToPlaylistHost";

let registered = false;

export const registerAddToPlaylistHost = (): void => {
  if (registered) return;
  registered = true;
  registerShellProvider(AddToPlaylistHost);
};
