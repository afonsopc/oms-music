/**
 * Social composition root (imported by boot/wireup.ts, WP12): the friends
 * listening feed and the per-user notifications stream.
 *
 * Both channels are receive-only and gated on an authed session with a live
 * credential (Bearer token, or the session cookie on a cookie origin).
 * The cable's foreground pump (AppState -> notifyForeground) is owned
 * by remote/register.ts; the friends manager rides it through its wake hook
 * to refresh the subscribe-time roster.
 */
import { queryClient } from "@/api/queryClient";
import { keys } from "@/api/queryKeys";
import { isAuthReady, subscribeAuthReady } from "@/auth/guard";
import { registerLogoutTask, useSessionStore } from "@/auth/session";
import { cableCredential } from "@/auth/token";
import { getCableClient } from "@/cable/client";
import { JAM_NOTICES, notifyJam } from "@/jam/notices";
import { FriendListeningManager } from "./listeningStore";
import { NotificationsManager } from "./notifications";

let registered = false;
let friends: FriendListeningManager | null = null;
let notifications: NotificationsManager | null = null;

const shouldRun = (): boolean => {
  const session = useSessionStore.getState();
  // null = no credential; "" = cookie auth (still a live credential).
  return session.status === "authed" && isAuthReady() && cableCredential() !== null;
};

const sync = (): void => {
  const credential = cableCredential();
  if (shouldRun() && credential !== null) {
    // Idempotent: the cable ignores a connect with the same live credential.
    getCableClient().connect(credential);
    friends?.start();
    notifications?.start();
    return;
  }
  friends?.stop();
  notifications?.stop();
};

/** Idempotent; boot/wireup.ts calls it once. */
export const registerSocial = (): void => {
  if (registered) return;
  registered = true;

  const cable = getCableClient();
  friends = new FriendListeningManager({ cable });
  notifications = new NotificationsManager({
    cable,
    onJamInvite: (invite) => {
      // There is no accept API: refresh `GET /jams` so the invited jam shows
      // up as joinable, and tell the user where to find it.
      void queryClient.invalidateQueries({ queryKey: keys.jams });
      notifyJam({
        key: JAM_NOTICES.inviteReceived,
        params: { handle: invite.inviterHandle ?? invite.hostHandle ?? "" },
      });
    },
  });

  useSessionStore.subscribe(sync);
  subscribeAuthReady(sync);
  registerLogoutTask(() => {
    friends?.stop();
    notifications?.stop();
  });

  sync();
};

/** Test/teardown helper; production never unregisters. */
export const unregisterSocial = (): void => {
  if (!registered) return;
  registered = false;
  friends?.stop();
  notifications?.stop();
  friends = null;
  notifications = null;
};
