/**
 * Native accessor for the `OmsStemMixer` surface of the local `oms-native`
 * module - the custom blend's audio engine (FR-69 / FR-70, DESIGN 16.A).
 *
 * OPTIONAL exactly like `OmsNative`: Expo Go, the web bundle and any binary
 * built before this surface landed simply do not have it, and the bridge then
 * reports `isAvailable() === false`, which is what keeps `custom` mode falling
 * back to the plain mix instead of throwing.
 *
 * iOS is implemented (ios/OmsStemMixerModule.swift). Android registers the
 * same module name once its mixer lands; nothing here is iOS-specific, so that
 * is a native-only change.
 *
 * WIRING (one line, and it does not live here): the app installs this into the
 * seam with `setStemMixer(getNativeStemMixer())` from
 * `src/contracts/stemMixer.ts`. This module never imports app code, so the
 * dependency arrow keeps pointing app -> module.
 */
import { requireOptionalNativeModule } from "expo";
import {
  createStemMixerBridge,
  inertStemMixerBridge,
  type NativeStemMixerModule,
  type StemMixerBridge,
} from "./stemMixerBridge";

const nativeModule = requireOptionalNativeModule<NativeStemMixerModule>("OmsStemMixer");

/** Built once: the bridge holds the `prepared` flag across every call site. */
const bridge: StemMixerBridge = createStemMixerBridge(nativeModule);

export const isStemMixerAvailable = (): boolean => bridge.isAvailable();

/**
 * The mixer, always non-null: without the native module it is the inert one,
 * which reports itself unavailable and no-ops everything.
 */
export const getNativeStemMixer = (): StemMixerBridge => bridge;

export { inertStemMixerBridge };
