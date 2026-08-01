/**
 * `oms-native` - the local Expo module that closes the two gaps the vendored
 * Expo packages leave open, without patching anything in node_modules:
 *
 * - FR-63: lock-screen next / previous. iOS registers additive targets on the
 *   process-wide MPRemoteCommandCenter (expo-audio never touches those two
 *   commands) and forwards them to JS as "nextTrack" / "previousTrack".
 *   Android is a documented no-op: expo-audio strips the track-navigation
 *   commands from the only MediaSession the app has.
 * - FR-84: excluding the downloads directory from system backup. iOS sets
 *   `isExcludedFromBackup`; Android is covered declaratively by this module's
 *   config plugin (app.plugin.js), which writes `android:fullBackupContent`
 *   and `android:dataExtractionRules` into the GENERATED native project.
 */
export {
  excludeFromBackup,
  getRemoteTrackCommands,
  isOmsNativeAvailable,
} from "./src/OmsNative";
export {
  createRemoteTrackRouter,
  inertRemoteTrackRouter,
  type RemoteTrackCommands,
  type RemoteTrackEvent,
  type RemoteTrackRouter,
  type RemoteTrackSubscription,
} from "./src/remoteTrackCommands";
