/**
 * Web fork of the adapter factory (Metro resolves `.web.ts` first, exactly
 * like db/kv.web.ts): on the web the engine's player is a plain
 * HTMLAudioElement wired honestly by webAudioAdapter.ts, NOT expo-audio's
 * AudioPlayerWeb. Measured in Chrome (F0 spike 2), the expo-audio web build
 * breaks three engine premises at once: play() never surfaces the
 * autoplay-policy rejection (ghost "playing" state, inverted toggle),
 * isBuffering is hardcoded false (the buffer-drain guard never protects
 * anything), and statuses only ride media events - a starved network emits
 * NOTHING while `paused` stays false, so both watchdogs sleep through an
 * indefinite silent hang. The full argument lives in webAudioAdapter.ts;
 * this file only binds the honest adapter to the name register.ts already
 * imports, so the native module graph and the native adapter stay
 * byte-identical.
 *
 * The SSG gate (Node prerender with no DOM `Audio`) lives inside
 * createWebAudioAdapter, same story as the native file's
 * createInertPrerenderAdapter.
 */
import { routeRemoteCommand } from "./lockScreen";
import type { AudioAdapter } from "./types";
import { createWebAudioAdapter, installAutoplayUnlock } from "./webAudioAdapter";

export const createExpoAudioAdapter = (): AudioAdapter => {
  // First user gesture unlocks the origin's autoplay with a 0-sample silent
  // WAV (docs/api-social-jams.md documents the same trick in the old web
  // client's jam join tap), demoting the blocked-autoplay affordance to the
  // rare case of a remote play adopted by a tab nobody ever touched.
  installAutoplayUnlock();
  return createWebAudioAdapter({
    // Hardware media keys / the browser's media hub: next and previous go
    // through the transport seam so a controller tab advances the ACTIVE
    // device (FR-63 parity with oms-native on iOS) - unlike expo-audio's
    // web controller, which maps nexttrack/previoustrack onto +-10 s seeks.
    onRemoteTrackCommand: (kind) => routeRemoteCommand({ kind }),
  });
};
