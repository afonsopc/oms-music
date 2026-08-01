# LOCKSCREEN-PATCH.md - enabling next/previous on the lock screen

**Status: iOS SHIPS. Android does not, and structurally cannot without patching
expo-audio.** Delivered by the local Expo module `modules/oms-native` (option C below),
which adds native code of its own instead of rewriting a dependency: nothing inside
`node_modules/` is modified, no patch tool runs, and `bunx expo prebuild --clean`
reproduces everything from a clean checkout.

Vendored version read for this document: `expo-audio@57.0.3`
(`node_modules/expo-audio/package.json:4`). Line numbers refer to that version.

What ships today:

| | iOS | Android |
| --- | --- | --- |
| lock-screen next / previous buttons | YES, `modules/oms-native` | no (see section 6) |
| JS event for them | YES, `"nextTrack"` / `"previousTrack"` | never emitted |
| routed through `contracts/transport` | YES, so a controller advances the ACTIVE device | n/a |
| downloads excluded from backup (FR-84) | YES, `isExcludedFromBackup` at runtime | YES, backup-rules XML from the same module's config plugin |

Sections 1-2 below stay as the record of WHY the module is shaped the way it is; section 6
is what actually landed and what is still open.

---

## 1. What the vendored module actually does

`setActiveForLockScreen(active, metadata, options)` reaches, per platform:

- iOS: `ios/AudioModule.swift:261` -> `ios/AudioPlayer.swift:157` ->
  `MediaController.shared.setActivePlayer(...)` (`ios/MediaController.swift:18`).
- Android: `android/.../AudioModule.kt:510` -> `AudioPlayer.kt:100` ->
  `AudioControlsService.setPlayerOptions(...)`.

Commands enabled today (`ios/MediaController.swift:234-312`, `enableRemoteCommands`):

| Command | iOS | Android |
| --- | --- | --- |
| play / pause / togglePlayPause | yes, handled natively against `AVPlayer` | yes, `ACTION_PLAY` / `ACTION_PAUSE` / `ACTION_TOGGLE` (`AudioControlsService.kt:78-92`) |
| changePlaybackPosition (scrub) | yes (`MediaController.swift:266`) | yes, via media3 seek commands |
| skipForward / skipBackward (10 s) | yes, opt-in through `showSeekForward` / `showSeekBackward` (`MediaController.swift:278-311`) | yes, custom `CommandButton`s (`AudioControlsService.kt:238-277`) |
| **nextTrack / previousTrack** | **untouched**: no `nextTrackCommand` / `previousTrackCommand` target is ever added AND neither is ever assigned `isEnabled` (not in `enableRemoteCommands`, not in `disableRemoteCommands`, `MediaController.swift:234-329`). That absence is what makes `modules/oms-native` possible: the two commands are unowned, so a second module can take them without a conflict | **removed on purpose**: `AudioMediaSessionCallback.kt:28-31` strips `COMMAND_SEEK_TO_NEXT_MEDIA_ITEM`, `COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM`, `COMMAND_SEEK_TO_NEXT`, `COMMAND_SEEK_TO_PREVIOUS` |

Two structural consequences:

1. **No JS remote-command events exist at all.** The only events an `AudioPlayer` emits are
   `playbackStatusUpdate` and `audioSampleUpdate` (`src/AudioModule.types.ts:278-283`;
   emitted at `ios/AudioPlayer.swift:172` and through `statusEventName` at
   `android/.../AudioPlayer.kt:59`). Even the commands that DO work are handled inside the
   native player, so JS never learns that the user pressed play on the lock screen; the
   engine only sees the resulting status update. That is why play/pause/seek stay honest
   today and why next/previous cannot be faked from JS.
2. **The module assumes one media item.** Both platforms drive a single-item player and
   expo-audio owns the queue nowhere, so track navigation must be forwarded to JS rather
   than executed natively.

---

## 2. The required native diff

Four files per platform plus the TypeScript surface. The shape below is the minimum that
makes `routeRemoteCommand({ kind: "next" })` fire.

### 2.1 iOS

**`ios/AudioRecords.swift:69-73`** - extend the options record:

```swift
struct LockScreenOptions: Record {
  @Field var showSeekForward: Bool = false
  @Field var showSeekBackward: Bool = false
  @Field var isLiveStream: Bool? = false
  @Field var showNextTrack: Bool = false      // ADD
  @Field var showPreviousTrack: Bool = false  // ADD
}
```

**`ios/AudioPlayer.swift:1-7`** - add the event name next to the existing constants:

```swift
private enum AudioConstants {
  static let playbackStatus = "playbackStatusUpdate"
  static let audioSample = "audioSampleUpdate"
  static let remoteCommand = "remoteCommand"   // ADD
}
```

and a tiny emitter on `AudioPlayer` (next to `updateStatus`, around line 166):

```swift
func emitRemoteCommand(_ command: String) {
  self.emit(event: AudioConstants.remoteCommand, payload: ["command": command])
}
```

**`ios/MediaController.swift:234-312`** (`enableRemoteCommands`) - add two targets and two
enable flags, mirroring the skipForward block:

```swift
remoteCommandCenter.nextTrackCommand.addTarget { [weak self] _ in
  guard let player = self?.activePlayer else { return .commandFailed }
  player.emitRemoteCommand("next")
  return .success
}

remoteCommandCenter.previousTrackCommand.addTarget { [weak self] _ in
  guard let player = self?.activePlayer else { return .commandFailed }
  player.emitRemoteCommand("previous")
  return .success
}

remoteCommandCenter.nextTrackCommand.isEnabled = options?.showNextTrack ?? false
remoteCommandCenter.previousTrackCommand.isEnabled = options?.showPreviousTrack ?? false
```

**`ios/MediaController.swift:314-329`** (`disableRemoteCommands`) - disable and
`removeTarget(self)` both new commands, exactly like the existing six.

Note on layout: iOS shows at most three transport buttons. With `showNextTrack` and
`showPreviousTrack` on, oms-music should pass `showSeekForward: false` and
`showSeekBackward: false` (see 3.2), otherwise the system picks and the result differs
between the lock screen and Control Center.

### 2.2 Android

**`android/.../AudioRecords.kt:110-114`** - same two fields:

```kotlin
class AudioLockScreenOptions(
  @Field val showSeekForward: Boolean,
  @Field val showSeekBackward: Boolean,
  @Field val isLiveStream: Boolean? = null,
  @Field val showNextTrack: Boolean = false,      // ADD
  @Field val showPreviousTrack: Boolean = false   // ADD
) : Record
```

**`android/.../service/AudioMediaSessionCallback.kt:22-33`** - stop stripping the track
commands when they are wanted:

```kotlin
MediaSession.ConnectionResult.DEFAULT_PLAYER_COMMANDS.buildUpon()
  .add(Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM)
  .add(Player.COMMAND_SEEK_FORWARD)
  .add(Player.COMMAND_SEEK_BACK)
  .add(Player.COMMAND_SEEK_TO_NEXT)          // was .remove(...)
  .add(Player.COMMAND_SEEK_TO_PREVIOUS)      // was .remove(...)
  .build()
```

(`COMMAND_SEEK_TO_NEXT_MEDIA_ITEM` / `..._PREVIOUS_MEDIA_ITEM` stay removed: there is only
one media item and media3 would grey the buttons out.)

**`android/.../service/MetadataInjectingPlayer.kt:18`** - this `ForwardingPlayer` is the
only object the session touches, so it is the interception point. Override the four entry
points and forward instead of delegating:

```kotlin
internal class MetadataInjectingPlayer(
  player: Player,
  private val onRemoteCommand: (String) -> Unit = {}   // ADD
) : ForwardingPlayer(player) {

  override fun seekToNext() = onRemoteCommand("next")
  override fun seekToPrevious() = onRemoteCommand("previous")
  override fun seekToNextMediaItem() = onRemoteCommand("next")
  override fun seekToPreviousMediaItem() = onRemoteCommand("previous")
```

`AudioControlsService` builds that wrapper (`sessionMetadataPlayer`), so pass
`onRemoteCommand = { currentPlayer?.emitRemoteCommand(it) }` where it is constructed.

**`android/.../service/AudioControlsService.kt`**:
- companion constants (`:553-560`): add `ACTION_NEXT` and `ACTION_PREVIOUS`.
- `onStartCommand` (`:78-92`): map those actions to
  `currentPlayer?.emitRemoteCommand("next" / "previous")` (never to the ExoPlayer).
- `updateSessionCustomLayout` (`:238-277`): when `showNextTrack` / `showPreviousTrack` are
  on, use `CommandButton.ICON_NEXT` / `ICON_PREVIOUS` with
  `.setPlayerCommand(Player.COMMAND_SEEK_TO_NEXT / _PREVIOUS)` in `SLOT_FORWARD` /
  `SLOT_BACK` instead of the skip-10 buttons (the slots are the same, so the two options
  are mutually exclusive per side).
- `buildNotification` (`:190-232`, the `SDK_INT <= S_V2` branch): add the matching
  `NotificationCompat.Action`s so Android 12 and older show them too.

**`android/.../AudioPlayer.kt`** - add the emitter used above, next to the existing
`emit(AUDIO_SAMPLE_UPDATE, ...)` (`:234`):

```kotlin
fun emitRemoteCommand(command: String) = emit(REMOTE_COMMAND, bundleOf("command" to command))
```

with `private const val REMOTE_COMMAND = "remoteCommand"` beside `PLAYBACK_STATUS_UPDATE`
(`:25`).

### 2.3 TypeScript surface of the module

- `src/AudioConstants.ts:5-19` (`AudioLockScreenOptions`): add optional `showNextTrack`,
  `showPreviousTrack`.
- `src/AudioModule.types.ts:278-283` (`AudioEvents`): add
  `remoteCommand(payload: { command: 'next' | 'previous' }): void;`.
- `src/AudioPlayer.web.ts:295` (`setActiveForLockScreen`): the web MediaSession path can
  map the same two names to `nexttrack` / `previoustrack` action handlers; optional, the
  app does not ship web.

---

## 3. The oms-music side (this is what SHIPPED, via `modules/oms-native`)

The adapter route in 3.1 below was NOT taken: it needs the `remoteCommand` event that only
the patched expo-audio would emit. The events come from our own module instead, so
`AudioAdapter` and `expoAudioAdapter.ts` are untouched.

### 3.1 Adapter (superseded, kept for the option-B/patched route)

`src/player/types.ts` (`AudioAdapter`): add
`onRemoteCommand(cb: (command: RemoteCommand) => void): () => void;`, implemented in
`src/player/expoAudioAdapter.ts` with `player.addListener("remoteCommand", ...)`.

### 3.2 Registration (shipped)

`modules/oms-native` exposes `getRemoteTrackCommands()` (null when the native module is not
in the binary) and the pure `createRemoteTrackRouter(commands, route)`.
`src/player/register.ts` builds the router once and installs it with
`setRemoteTrackRouter`; the route callback is `routeRemoteCommand({ kind })`, which already
dispatches through `contracts/transport`, so on a controller device the lock-screen next
advances the ACTIVE remote device (FR-63 remote half) with no further work.

`src/player/lockScreen.ts#publishLockScreen` calls `router.setActive(song !== null)` on the
same beat as `setActiveForLockScreen`, so the two buttons exist exactly while a song is
published. This is not optional bookkeeping: expo-audio's `disableRemoteCommands` does not
touch `nextTrackCommand` / `previousTrackCommand`, so if we never disabled them nobody
would.

Still open: `src/player/expoAudioAdapter.ts#setLockScreenActive` passes
`{ showSeekForward: true, showSeekBackward: true }`. iOS shows at most three transport
controls, so with next/previous now enabled the +-10 s buttons compete for the same slots
and the lock screen and Control Center can disagree. Flipping those two to `false` is the
matching change and belongs to whoever owns `expoAudioAdapter.ts` (see the layout note in
2.1). Android is unaffected: it has neither button.

### 3.3 Fallback where the module is absent

`createRemoteTrackRouter(null, ...)` returns `inertRemoteTrackRouter`, so Android, web,
Expo Go and any build made before this module landed behave exactly as before: lock-screen
play/pause/scrub keep working through expo-audio's native handlers and the engine keeps
mirroring status updates into the store, so the UI never disagrees with the lock screen.

The CONTROLLER gap is now closed on iOS and still open on Android: `enterController()`
(`remote/channel.ts`) clears the local source, then `setLockScreenSongOverride` publishes
the REMOTE song's metadata, so the lock screen shows a track whose play/pause/scrub act on
an empty local player. On iOS the user at least gets working next/previous (they route to
the active device); on Android the in-app controls remain the only working ones on a
controller.

---

## 4. Delivery options

### Option C - a local Expo MODULE under `modules/` (CHOSEN, shipped)

`modules/oms-native`: a standard Expo Modules API package (`expo-module.config.json`,
`ios/`, `android/`, `index.ts`, `app.plugin.js`) autolinked from the app's `modules`
directory (`nativeModulesDir` defaults to `./modules`), with its config plugin registered
in `app.json` as `"./modules/oms-native/app.plugin.js"`.

It ADDS native code; it never rewrites expo-audio. On iOS that works because
`MPRemoteCommandCenter.shared()` is a process-wide singleton and expo-audio leaves
`nextTrackCommand` / `previousTrackCommand` completely unowned (section 1). Our module adds
a target to each, flips `isEnabled` in step with lock-screen activation, and forwards the
presses to JS as the `"nextTrack"` / `"previousTrack"` events. expo-audio's own play /
pause / togglePlayPause / changePlaybackPosition / skipForward / skipBackward targets are
untouched and keep working natively.

The same module carries FR-84: `excludeFromBackup(path)` sets `isExcludedFromBackup` on
iOS, and the config plugin writes the Android backup rules (section 6.2).

Properties: reproducible from a clean checkout, no `node_modules` diff, no patch tool, no
new dependency, no paid library, and no re-verification needed on an expo-audio bump (there
is nothing to re-anchor - only the assumption that expo-audio still ignores those two
commands, which section 6.3 says how to re-check). Cost: iOS only, and the module's Swift
cannot be type-checked without a `pod install`.

### Option A - a local Expo config plugin that rewrites the vendored sources

Create `modules/oms-audio-lockscreen/app.plugin.js` and add it to `app.json` `plugins`.
The plugin uses `withDangerousMod` for both platforms and rewrites the vendored sources
before `pod install` / the Gradle build sees them:

- `withDangerousMod(config, ['ios', ...])`: resolve
  `node_modules/expo-audio/ios/{MediaController,AudioPlayer,AudioRecords}.swift`, assert the
  expected anchor strings are present (fail loudly on a version bump), and apply the string
  replacements from section 2.1.
- `withDangerousMod(config, ['android', ...])`: same for the four Kotlin files in 2.2.
- Ship the anchors as exact substrings plus a `expo-audio` version guard so a future
  `expo-audio` release cannot be silently half-patched.

Properties: reproducible from a clean checkout (`bunx expo prebuild --clean` reapplies it),
no `node_modules` diff committed, no extra dependency, no paid library. Costs: it edits a
dependency's sources at build time, it must be re-verified on every expo-audio bump, and
the TypeScript surface of the module (2.3) has to be declared locally (a small
`types/expo-audio-remote.d.ts` module augmentation) because the plugin cannot change the
published `.d.ts` used by `tsc`.

`bun patch` / `patch-package` would deliver the same edit and are deliberately NOT used
here: they persist a diff against a dependency that this repo has chosen not to carry.

### Option B - swap the engine backend to `@rntp/player` v5

`@rntp/player` (the maintained successor to `react-native-track-player`, paid license)
exposes `Event.RemoteNext` / `Event.RemotePrevious` / `RemoteJumpForward` and a full
capability list, so no native patch is needed.

Blast radius is exactly `src/player/expoAudioAdapter.ts` plus
`src/player/register.ts`: the engine talks to the `AudioAdapter` interface only
(`src/player/types.ts`), which is why the interface exists. `player/lockScreen.ts` metadata
publishing would move into the library's `updateNowPlayingMetadata`. The jam follower
(`src/jam/expoFollowerAudio.ts`) can stay on expo-audio: it is a second, non-lock-screen
player.

Properties: no dependency patching, official remote-command events, better background
service behavior on Android. Costs: a paid license, an install (approval required), a
larger native footprint, and re-validating the WP3 device matrix (background survival,
rapid-skip soak, FLAC decode failure) on the new backend.

---

## 5. Acceptance for whichever option is chosen

1. Lock screen and Control Center show previous / play-pause / next on iOS; the media
   notification shows the same three on Android 13+ and on Android 12.
2. Pressing next on the lock screen while the app is backgrounded advances the queue and
   the notification metadata follows, with no audible gap beyond a normal skip.
3. On a device that is CONTROLLING another device, lock-screen next advances the remote
   device and this device stays silent (FR-63 remote half, transport decorator).
4. While following a jam, lock-screen next does nothing locally (the follower has no
   queue) and never leaves the jam.
5. Rapid double-press of next never plays a stale track (WP3 rapid-skip soak still green).

Point 1's Android half is NOT met and will not be met by option C. Points 1 (iOS), 2, 3, 4
and 5 are device checks that still need a real build; nothing here has run on hardware.

---

## 6. What `modules/oms-native` actually contains

### 6.1 FR-63, iOS

- `ios/OmsNativeModule.swift` - `Name("OmsNative")`, `Events("nextTrack",
  "previousTrack")`, `Function("setRemoteTrackCommandsEnabled")` (installs the two
  `addTarget` handlers on first enable, keeps the returned tokens, then only flips
  `isEnabled`), and `OnDestroy` removes them. Everything touching
  `MPRemoteCommandCenter` hops to the main thread first.
  - Note for anyone reading expo-audio's `disableRemoteCommands`: it calls
    `removeTarget(self)` for its own six commands, but those were registered with the
    block form `addTarget(handler:)`, which returns a TOKEN and is not matched by
    `removeTarget(self)`. That is why our module stores the tokens instead.
- `src/remoteTrackCommands.ts` - import-free, so bun can unit test it:
  `createRemoteTrackRouter(commands, route)`, `inertRemoteTrackRouter`, and the
  `RemoteTrackCommands` / `RemoteTrackRouter` types. Tests:
  `src/__tests__/remoteTrackCommands.test.ts` (fake emitter: routing, single
  subscription, idempotent enable, teardown).
- `src/OmsNative.ts` - `requireOptionalNativeModule("OmsNative")`, so every call degrades
  to a no-op when the module is not in the binary. Never throws.
- App wiring: `src/player/register.ts` (install the router) and
  `src/player/lockScreen.ts` (`setRemoteTrackRouter`, plus `setActive` inside
  `publishLockScreen`).

### 6.2 FR-84, both platforms

- iOS: `excludeFromBackup(uri)` -> `setResourceValues(isExcludedFromBackup: true)`.
  `src/downloads/paths.ts#ensureUserDownloadDirectory` calls it right after
  `dir.create(...)`, once per path per launch, for the `oms-downloads` root AND the
  per-user directory.
- Android: `app.plugin.js` writes `res/xml/oms_backup_rules.xml` (`<full-backup-content>`,
  Android 11 and older) and `res/xml/oms_data_extraction_rules.xml`
  (`<data-extraction-rules>` with both `<cloud-backup>` and `<device-transfer>`, Android
  12+), both excluding `domain="file" path="oms-downloads/"`, and points
  `android:fullBackupContent` / `android:dataExtractionRules` at them on the main
  `<application>`. `domain="file"` is the app's internal files dir, which is exactly what
  expo-file-system reports as `Paths.document`
  (`FileSystemModule.kt` -> `appContext.persistentFilesDirectory`).
  The native `excludeFromBackup` returns `false` on Android by design.
  Verified by running `expo prebuild --platform android` and reading the generated
  manifest and `res/xml`.

### 6.3 Why Android gets no next/previous, and what would change that

expo-audio owns the app's only `MediaSession` and closes every extension point:

1. `AudioMediaSessionCallback.onConnect` removes `COMMAND_SEEK_TO_NEXT`,
   `COMMAND_SEEK_TO_PREVIOUS` and both `*_MEDIA_ITEM` variants from the available player
   commands of EVERY controller, the system media controller included. Available commands
   are decided by the session's callback, so a controller cannot grant itself more.
2. The callback is constructed inline inside
   `MediaSession.Builder(...).setCallback(AudioMediaSessionCallback())`
   (`AudioControlsService.kt:373` and `:454`) and media3 cannot swap a session's callback
   afterwards.
3. `mediaSession` is a `private var` on `AudioControlsService` and the notification layout
   comes from the private `updateSessionCustomLayout`, which hard-codes skip-10 buttons
   into `SLOT_BACK` / `SLOT_FORWARD`.
4. `MetadataInjectingPlayer`, the `ForwardingPlayer` that would be the interception point,
   is `internal` and instantiated privately.

Publishing a SECOND `MediaSession` from our module would put a competing media
notification in the shade, detached from the actual playback - worse than no buttons. So
Android stays a no-op until either the expo-audio diff in section 2.2 is applied (option A
or upstream) or the backend swaps (option B).

### 6.4 Re-verifying on an expo-audio bump

The single assumption is: expo-audio still never adds a target to, and never assigns
`isEnabled` on, `nextTrackCommand` / `previousTrackCommand`. One grep answers it:

```sh
grep -rn "nextTrackCommand\|previousTrackCommand" node_modules/expo-audio/ios/
```

No hits means the module is still purely additive. Hits mean the two sides now fight over
the same commands, and `modules/oms-native` should be reduced to the FR-84 half.
