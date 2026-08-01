// OmsNativeModule - the two native gaps expo-audio and expo-file-system leave open.
//
// FR-63 (lock-screen next/previous):
//   MPRemoteCommandCenter.shared() is a PROCESS-WIDE singleton. The vendored
//   expo-audio 57.0.3 (ios/MediaController.swift:234-329) adds targets to
//   play / pause / togglePlayPause / changePlaybackPosition / skipForward /
//   skipBackward and never mentions nextTrackCommand or previousTrackCommand -
//   it neither adds a target to them nor sets isEnabled on them, in
//   enableRemoteCommands OR disableRemoteCommands. Registering our own targets
//   on those two commands is therefore purely additive: expo-audio keeps
//   owning play/pause/seek natively, we own next/previous and forward them to
//   JS, and neither side can clobber the other. (Because expo-audio's
//   disableRemoteCommands does not touch them either, the enabled state is
//   ours alone to manage - hence setRemoteTrackCommandsEnabled, which the JS
//   side keeps in lockstep with setActiveForLockScreen.)
//
// FR-84 (downloads excluded from backup):
//   expo-file-system SDK 57 exposes no isExcludedFromBackup flag, so the
//   downloads directory would otherwise ride into iCloud/iTunes backups.
//
// Both entry points are safe to call repeatedly.
import ExpoModulesCore
import MediaPlayer

private let nextTrackEvent = "nextTrack"
private let previousTrackEvent = "previousTrack"

public final class OmsNativeModule: Module {
  /// Tokens returned by addTarget(handler:) - the ONLY way to remove a
  /// block-based target again (removeTarget(self) does not match one).
  private var nextTrackTarget: Any?
  private var previousTrackTarget: Any?

  public func definition() -> ModuleDefinition {
    Name("OmsNative")

    Events(nextTrackEvent, previousTrackEvent)

    // Show/hide the two lock-screen buttons. Targets are installed lazily on
    // the first enable and then kept, so toggling is just an isEnabled flip.
    Function("setRemoteTrackCommandsEnabled") { (enabled: Bool) in
      onMainThread {
        self.applyTrackCommands(enabled: enabled)
      }
    }

    // Marks a directory (or file) as excluded from iCloud / iTunes backups.
    // Accepts both "file:///..." URLs and bare paths. Returns false when the
    // target does not exist or the flag could not be written.
    Function("excludeFromBackup") { (path: String) -> Bool in
      return excludeUrlFromBackup(path: path)
    }

    OnDestroy {
      onMainThread {
        self.removeTrackCommands()
      }
    }
  }

  // MARK: - Remote commands

  private func applyTrackCommands(enabled: Bool) {
    let center = MPRemoteCommandCenter.shared()

    if enabled {
      if nextTrackTarget == nil {
        nextTrackTarget = center.nextTrackCommand.addTarget { [weak self] _ in
          guard let self else {
            return .commandFailed
          }
          self.sendEvent(nextTrackEvent)
          return .success
        }
      }
      if previousTrackTarget == nil {
        previousTrackTarget = center.previousTrackCommand.addTarget { [weak self] _ in
          guard let self else {
            return .commandFailed
          }
          self.sendEvent(previousTrackEvent)
          return .success
        }
      }
    }

    center.nextTrackCommand.isEnabled = enabled
    center.previousTrackCommand.isEnabled = enabled
  }

  private func removeTrackCommands() {
    let center = MPRemoteCommandCenter.shared()

    center.nextTrackCommand.isEnabled = false
    center.previousTrackCommand.isEnabled = false

    if let nextTrackTarget {
      center.nextTrackCommand.removeTarget(nextTrackTarget)
    }
    if let previousTrackTarget {
      center.previousTrackCommand.removeTarget(previousTrackTarget)
    }
    nextTrackTarget = nil
    previousTrackTarget = nil
  }
}

// MARK: - Helpers

private func onMainThread(_ work: @escaping () -> Void) {
  if Thread.isMainThread {
    work()
  } else {
    DispatchQueue.main.async(execute: work)
  }
}

private func excludeUrlFromBackup(path: String) -> Bool {
  guard var url = fileUrl(from: path) else {
    return false
  }
  guard FileManager.default.fileExists(atPath: url.path) else {
    return false
  }

  var values = URLResourceValues()
  values.isExcludedFromBackup = true
  do {
    try url.setResourceValues(values)
    return true
  } catch {
    return false
  }
}

private func fileUrl(from path: String) -> URL? {
  if let url = URL(string: path), url.isFileURL {
    return url
  }
  guard !path.isEmpty else {
    return nil
  }
  return URL(fileURLWithPath: path)
}
