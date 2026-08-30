/**
 * Jam composition root (imported by boot/wireup.ts, WP12).
 *
 * This is the ONLY file in src/jam that knows about the concrete engine, the
 * cable singleton, the session store and expo-audio - the protocol modules
 * (channel, followerPlayer, hostDuties, interceptor) see nothing but the
 * interfaces in types.ts, so they stay testable with fakes in bun.
 *
 * Wiring, in order:
 *  1. the follower player over a SECOND expo-audio player;
 *  2. the jam manager over the hand-rolled cable client, with the host duty
 *     of stealing the active playback device on create (every jam relay
 *     rides the host's PlaybackChannel publishes);
 *  3. host duties on the jam command seam (remote/jamBridge), so a
 *     server-built `jam_add_song` lands FIFO after the current song and a
 *     passed skip vote advances the host;
 *  4. the proposal interceptor, installed only while following a jam that
 *     accepts proposals;
 *  5. follower volume mirrored from the player store, and the auto-leave
 *     watcher that drops the jam when the user starts their own music;
 *  6. auth gating: start while authed, wipe on logout or auth loss.
 *
 * The cable's foreground pump (AppState -> notifyForeground) is owned by
 * remote/register.ts and shared by every channel; nothing is added here, so
 * a foreground never fires the wake hooks twice.
 */
import { oms } from "@/api/oms";
import { queryClient } from "@/api/queryClient";
import { keys } from "@/api/queryKeys";
import { isAuthReady, subscribeAuthReady } from "@/auth/guard";
import { registerLogoutTask, useSessionStore } from "@/auth/session";
import { cableCredential } from "@/auth/token";
import { getCableClient } from "@/cable/client";
import { getTransport } from "@/contracts/transport";
import { getPlayerEngine } from "@/player/register";
import { playerStore } from "@/player/store";
import { getPlaybackChannel } from "@/remote/channel";
import { setJamCommandHandler } from "@/remote/jamBridge";
import type { Jam, JamsIndex } from "@/domain/jam";
import { JamManager, getJamManager, setJamManager, type JamApi } from "./channel";
import { createExpoFollowerAudio } from "./expoFollowerAudio";
import { FollowerPlayer } from "./followerPlayer";
import { createJamCommandHandler } from "./hostDuties";
import { installJamInterceptor } from "./interceptor";
import { applyJam, jamStore } from "./store";

let registered = false;
let teardownInterceptor: (() => void) | null = null;

const shouldRun = (): boolean => {
  const session = useSessionStore.getState();
  // null = no credential; "" = cookie auth (still a live credential).
  return session.status === "authed" && isAuthReady() && cableCredential() !== null;
};

const syncSubscription = (): void => {
  const manager = getJamManager();
  if (!manager) return;
  const session = useSessionStore.getState();
  const credential = cableCredential();
  const userId = session.user?.id ?? null;
  if (shouldRun() && credential !== null && userId) {
    // Idempotent: the cable ignores a connect with the same live credential.
    getCableClient().connect(credential);
    if (!manager.isStarted()) manager.start(userId);
    else applyJam({ myUserId: userId });
    return;
  }
  if (manager.isStarted()) manager.stop();
};

/**
 * Idempotent; boot/wireup.ts calls it once. Safe to call before login: the
 * manager only starts once the session store reports an authed session.
 */
export const registerJam = (): void => {
  if (registered) return;
  registered = true;

  const engine = getPlayerEngine();

  const follower = new FollowerPlayer({
    createPlayer: createExpoFollowerAudio,
    onPosition: (seconds) => {
      if (jamStore.getState().followerPosition === seconds) return;
      applyJam({ followerPosition: seconds });
    },
  });

  // The jams REST surface the manager is injected with (jam/channel.ts
  // JamApi), over the SDK. Join BEFORE subscribing JamChannel; the host
  // leaving ENDS the jam (no handoff). Casts: the SDK's Jam is the wire, the
  // domain's brands the ids.
  const jams = () => oms().music.social.jams;
  const jamApi: JamApi = {
    getJams: () => jams().list() as Promise<JamsIndex>,
    createJam: () => jams().create() as Promise<Jam>,
    joinJam: (id) => jams().join(id) as Promise<Jam>,
    leaveJam: (id) => jams().leave(id),
    endJam: (id) => jams().end(id),
    updateJamRules: (id, rules) => jams().updateRules(id, rules) as Promise<Jam>,
    inviteToJam: (id, userId) => jams().invite(id, userId),
    proposeJamSong: (id, songId) => jams().propose(id, songId),
    jamSkipVote: (id) => jams().skipVote(id),
  };

  const manager = new JamManager({
    cable: getCableClient(),
    api: jamApi,
    follower,
    claimActiveSteal: () => getPlaybackChannel()?.claimActive("steal"),
    // Joining silences local playback through the transport, so a controller
    // stops the ACTIVE device rather than only this one.
    pauseLocalPlayback: () => getTransport().pause(),
    invalidateJams: () => {
      void queryClient.invalidateQueries({ queryKey: keys.jams });
    },
  });
  setJamManager(manager);

  // Host duties on the jam command seam (server-built commands only).
  setJamCommandHandler(
    createJamCommandHandler({
      insertJamProposal: (song) => engine.insertJamProposal(song),
      next: (cause) => engine.next(cause ?? "user"),
    }),
  );

  teardownInterceptor = installJamInterceptor((songId) => {
    void manager.propose(songId);
  });

  // Follower volume mirrors the player's volume control (local only).
  let lastVolume = playerStore.getState().volume;
  let lastPlaying = playerStore.getState().playing;
  follower.setVolume(lastVolume);
  playerStore.subscribe((state) => {
    if (state.volume !== lastVolume) {
      lastVolume = state.volume;
      follower.setVolume(lastVolume);
    }
    if (state.playing !== lastPlaying) {
      lastPlaying = state.playing;
      // Starting real local playback while following ends the jam for us.
      if (lastPlaying) manager.onLocalPlaybackStarted();
    }
  });

  useSessionStore.subscribe(syncSubscription);
  subscribeAuthReady(syncSubscription);
  registerLogoutTask(() => {
    getJamManager()?.stop();
  });

  syncSubscription();
};

/** Test/teardown helper; production never unregisters. */
export const unregisterJam = (): void => {
  if (!registered) return;
  registered = false;
  teardownInterceptor?.();
  teardownInterceptor = null;
  setJamCommandHandler(null);
  getJamManager()?.stop();
  setJamManager(null);
};
