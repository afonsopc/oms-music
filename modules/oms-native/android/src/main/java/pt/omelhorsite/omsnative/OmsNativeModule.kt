package pt.omelhorsite.omsnative

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Android half of oms-native. Both entry points are deliberate no-ops; the
 * reasons are structural, not laziness.
 *
 * FR-63 (lock-screen next/previous) - IMPOSSIBLE from a second module.
 * expo-audio 57.0.3 owns the only MediaSession the app has
 * (`AudioControlsService`, a MediaSessionService) and:
 *   1. `AudioMediaSessionCallback.onConnect` REMOVES `COMMAND_SEEK_TO_NEXT`,
 *      `COMMAND_SEEK_TO_PREVIOUS` and both `*_MEDIA_ITEM` variants from the
 *      available player commands of EVERY controller that connects, the system
 *      media controller included. Available commands are decided by the
 *      session's callback, so a controller cannot grant itself more.
 *   2. That callback is constructed inline
 *      (`MediaSession.Builder(context, sessionPlayer).setCallback(AudioMediaSessionCallback())`,
 *      AudioControlsService.kt:373 and :454) and media3 exposes no way to swap
 *      a session's callback afterwards.
 *   3. The notification layout is built by the private
 *      `updateSessionCustomLayout`, which hard-codes skip-10 buttons into
 *      SLOT_BACK / SLOT_FORWARD on a `private var mediaSession`. Nothing
 *      outside the expo package holds that session.
 *   4. `MetadataInjectingPlayer`, the ForwardingPlayer that would be the
 *      interception point, is `internal` and instantiated privately.
 * Publishing a SECOND MediaSession from here would produce a competing media
 * notification detached from the actual playback, which is worse than no
 * buttons. The honest fix stays the expo-audio patch documented in
 * docs/LOCKSCREEN-PATCH.md section 2.2.
 *
 * FR-84 (backup exclusion) - handled declaratively instead. Android has no
 * per-file backup flag; exclusion is `android:fullBackupContent` /
 * `android:dataExtractionRules` on the application, which this module's config
 * plugin (app.plugin.js) writes into the generated manifest and res/xml.
 */
class OmsNativeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("OmsNative")

    // Declared so the JS event surface is identical on both platforms; never
    // emitted on Android (see 1-4 above).
    Events("nextTrack", "previousTrack")

    Function("setRemoteTrackCommandsEnabled") { _: Boolean ->
      // No-op: expo-audio strips the track-navigation commands from its
      // MediaSession and owns the notification layout.
    }

    Function("excludeFromBackup") { _: String ->
      // No-op: exclusion is declarative (config plugin), not per-path.
      false
    }
  }
}
