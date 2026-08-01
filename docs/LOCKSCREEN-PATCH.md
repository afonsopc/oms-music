# LOCKSCREEN-PATCH.md - enabling next/previous on the lock screen

Status: NOT applied. `player/lockScreen.ts#routeRemoteCommand` is wired to the transport
seam and inert, because nothing ever calls it. This document is the exact native change
required to call it, plus the two ways to deliver that change. Nothing inside
`node_modules/` was modified and no patch tool was run; picking and applying one of the
options below is a deliberate decision for the repo owner.

Vendored version read for this document: `expo-audio@57.0.3`
(`node_modules/expo-audio/package.json:4`). Line numbers refer to that version.

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
| **nextTrack / previousTrack** | **absent**: no `nextTrackCommand` / `previousTrackCommand` target is ever added, so the buttons never appear | **removed on purpose**: `AudioMediaSessionCallback.kt:28-31` strips `COMMAND_SEEK_TO_NEXT_MEDIA_ITEM`, `COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM`, `COMMAND_SEEK_TO_NEXT`, `COMMAND_SEEK_TO_PREVIOUS` |

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

## 3. The oms-music side (small, and only worth writing once the native side exists)

### 3.1 Adapter

`src/player/types.ts` (`AudioAdapter`): add
`onRemoteCommand(cb: (command: RemoteCommand) => void): () => void;`.

`src/player/expoAudioAdapter.ts`: implement it with
`player.addListener("remoteCommand", ...)` mapping `"next"`/`"previous"` to the existing
`RemoteCommand` union in `player/lockScreen.ts`.

### 3.2 Registration

`src/player/register.ts`: after creating the adapter,
`adapter.onRemoteCommand(routeRemoteCommand)`. `routeRemoteCommand` already dispatches
through `contracts/transport`, so on a controller device the lock-screen next advances the
ACTIVE remote device (FR-63 remote half) with no further work.

`src/player/expoAudioAdapter.ts#setLockScreenActive` currently passes
`{ showSeekForward: true, showSeekBackward: true }`; switch to
`{ showNextTrack: true, showPreviousTrack: true }` (see the iOS layout note in 2.1).

### 3.3 Fallback while unpatched

Nothing to do. `routeRemoteCommand` stays exported and unused, lock-screen
play/pause/scrub keep working through the native handlers, and the engine keeps mirroring
status updates into the store, so the UI never disagrees with the lock screen.

---

## 4. Delivery options

### Option A - a local Expo config plugin under `modules/`

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
