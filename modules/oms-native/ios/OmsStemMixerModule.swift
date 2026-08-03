// OmsStemMixerModule - the iOS half of the custom blend (FR-69 / FR-70,
// DESIGN 16.A amendment 2026-08-03).
//
// WHAT THIS IS NOT: a player. expo-audio keeps the ORIGINAL file loaded and
// playing throughout custom mode, MUTED by the gain law (`mainGain = 0`). It
// stays the transport clock, the source of duration / position / ended, and
// the sole owner of MPNowPlayingInfoCenter + MPRemoteCommandCenter. That is
// exactly what frontend/lib/vocalSeparation.ts does on the web, and it is what
// keeps this module out of a fight with expo-audio's MediaController, which is
// bound to its own AVPlayer instance (node_modules/expo-audio/ios/
// MediaController.swift:24-28, :234-306). This module only ever produces
// SOUND, from two local stem files.
//
// Graph (one engine, one render clock):
//
//   vocals AVAudioFile -> AVAudioPlayerNode -> AVAudioUnitVarispeed --.
//                                                                      |-> per-stem
//                                                     AVAudioMixerNode |   gain
//                                                                      '--------.
//                                                                               v
//   instrumental      -> AVAudioPlayerNode -> AVAudioUnitVarispeed -> mixer -> sum
//                                                                               |
//   sum -> AVAudioUnitEQ(lowShelf 120, parametric 1k Q=1, highShelf 8k) -> mainMixerNode -> output
//
// Sync is structural, not negotiated: both player nodes are scheduled with the
// SAME segment offset and started with ONE shared AVAudioTime, so the engine
// converts a single instant into the same render-cycle sample for both. Every
// transport event (play / pause / seek) tears both schedules down and rebuilds
// them as a pair, which is the web's rule verbatim (vocalSeparation.ts:408-425)
// and is why no continuous drift loop is needed. `resync` exists on top of that
// for the ONE thing structure cannot fix: the muted AVPlayer's own resume
// latency, which this module cannot observe.
//
// AVAudioFile is local-file-only (ExtAudioFileOpenURL cannot open http(s)), so
// the JS side guarantees both stems are on disk before it ever calls prepare.
// A remote uri is rejected loudly rather than silently producing a half mix.
//
// Audio session: this module NEVER calls setCategory and NEVER calls
// setActive(false). The app already configures a deliberately non-mixable
// `.playback` session from JS (src/player/register.ts + expo-audio's
// AudioModule.swift:786-821), and an AVAudioEngine in the same process simply
// inherits it. setActive(true) is attempted only as a one-shot recovery when
// engine.start() fails, because that call is a no-op on an already-active
// session and cannot disturb the muted AVPlayer alongside us.
//
// DESIGN LIMITS, reasoned from the sources rather than measured on a device
// (each one needs a device pass to confirm; none of them can be fixed here):
//
//  1. Stem-to-stem sync is EXACT and does not drift. Both nodes take the same
//     segment offset and one shared AVAudioTime, and every transport event
//     rebuilds the pair, so their relative offset is fixed at zero samples by
//     construction, not maintained by a loop.
//  2. Mixer-to-reference sync is NOT exact. The muted AVPlayer's own resume
//     latency is invisible from here, so the blend can sit a few tens of
//     milliseconds off the scrub bar after a resume. `startLocked` folds the
//     lead (2 IO buffers, 20 ms floor / 100 ms ceiling) into the file offset
//     to cancel the part that IS knowable; `resync` exists for the rest, and
//     it is the only thing that can see the reference clock at all.
//  3. The lead is also the worst-case gap between muting the original and the
//     blend becoming audible, because the adapter applies the gain law before
//     it calls play. Under ~100 ms in every case.
//  4. Rate uses two AVAudioUnitVarispeed units, one per stem, at the same
//     value. They stay sample-locked because both are deterministic
//     resamplers pulled for the same frame count in the same render cycle;
//     one shared unit after the sum would be a smaller graph but would put a
//     time effect downstream of a mixer, which is the less-trodden topology.
//  5. Position is read from the vocals node's own player timeline, so it
//     counts FILE frames and is already rate-corrected. It cannot advance
//     while the engine is stopped, which is exactly what pause/interruption
//     want.
//  6. An interruption is reported as `playing: false` rather than resumed
//     silently: JS drives the resume through the same call the muted AVPlayer
//     gets, so the two always come back together.
import AVFoundation
import ExpoModulesCore
import Foundation

private let statusEvent = "statusUpdate"

/// The three web bands, verbatim (frontend/lib/audioEqualizer.ts:32-47).
private let lowShelfFrequency: Float = 120
private let midPeakFrequency: Float = 1000
private let highShelfFrequency: Float = 8000

/// Web `peaking` pins Q = 1; AVAudioUnitEQ takes octaves instead.
/// BW = (2 / ln2) * asinh(1 / (2Q)); for Q = 1 that is 1.3886 octaves, well
/// inside AVAudioUnitEQFilterParameters' documented 0.05 ... 5.0 range.
private let midBandwidthOctaves: Float = 1.3886

private let eqMinDb: Double = -12
private let eqMaxDb: Double = 12

/// AVAudioUnitVarispeed's documented range (AVAudioUnitVarispeed.h).
private let rateMin: Double = 0.25
private let rateMax: Double = 4.0

/// Floor for the shared start instant. `playAtTime:` treats a time already in
/// the past as "now", which would start the two nodes on different render
/// cycles, so the lead has to clear at least one full IO buffer.
private let minimumLeadSeconds: Double = 0.020
private let maximumLeadSeconds: Double = 0.100

// MARK: - Exceptions

internal final class StemUriNotLocalException: GenericException<String>, @unchecked Sendable {
  override var reason: String {
    "Stem uri is not a local file (AVAudioFile cannot stream): \(param)"
  }
}

internal final class StemFileMissingException: GenericException<String>, @unchecked Sendable {
  override var reason: String {
    "Stem file does not exist: \(param)"
  }
}

internal final class StemFileUnreadableException: GenericException<String>, @unchecked Sendable {
  override var reason: String {
    "Stem file could not be opened: \(param)"
  }
}

internal final class StemFileEmptyException: GenericException<String>, @unchecked Sendable {
  override var reason: String {
    "Stem file has no audio frames: \(param)"
  }
}

// MARK: - The node graph

/// Every AVAudio object in one box so a media-services reset can throw the
/// whole thing away and build a fresh one (Apple's prescribed recovery: the
/// engine and its nodes are invalid after that notification).
private final class MixerGraph {
  let engine = AVAudioEngine()
  let vocalsPlayer = AVAudioPlayerNode()
  let instrumentalPlayer = AVAudioPlayerNode()
  let vocalsRate = AVAudioUnitVarispeed()
  let instrumentalRate = AVAudioUnitVarispeed()
  let vocalsGain = AVAudioMixerNode()
  let instrumentalGain = AVAudioMixerNode()
  let sum = AVAudioMixerNode()
  let equalizer = AVAudioUnitEQ(numberOfBands: 3)

  private var attached = false

  func attachIfNeeded() {
    guard !attached else {
      return
    }
    attached = true
    for node in [
      vocalsPlayer, instrumentalPlayer,
      vocalsRate, instrumentalRate,
      vocalsGain, instrumentalGain,
      sum, equalizer
    ] as [AVAudioNode] {
      engine.attach(node)
    }

    equalizer.bands[0].filterType = .lowShelf
    equalizer.bands[0].frequency = lowShelfFrequency
    equalizer.bands[1].filterType = .parametric
    equalizer.bands[1].frequency = midPeakFrequency
    equalizer.bands[1].bandwidth = midBandwidthOctaves
    equalizer.bands[2].filterType = .highShelf
    equalizer.bands[2].frequency = highShelfFrequency
    for band in equalizer.bands {
      band.gain = 0
      band.bypass = true
    }
    equalizer.bypass = true
  }

  /// (Re)wires everything. The two stem branches carry the FILE format so the
  /// player nodes report position in file frames; the shared tail runs at a
  /// standard float format, which the per-stem mixers convert into.
  ///
  /// Every bus is written out explicitly. `connect(_:to:format:)` resolves a
  /// MIXER destination to its `nextAvailableInputBus` (AVAudioEngine.h:236-238),
  /// so a second call - a new song, or a route change - would walk the two stem
  /// inputs up onto fresh buses each time and leave the freed ones behind. A
  /// full input disconnect plus fixed indices makes a re-wire byte-identical
  /// to the first one.
  func connect(vocalsFormat: AVAudioFormat, instrumentalFormat: AVAudioFormat) {
    attachIfNeeded()

    // Touching mainMixerNode instantiates the output node, which is what gives
    // the tail a real hardware sample rate to converge on. It reads 0 while the
    // session is inactive, hence the fallback.
    let tailRate = engine.mainMixerNode.outputFormat(forBus: 0).sampleRate
    let tailFormat =
      AVAudioFormat(standardFormatWithSampleRate: tailRate > 0 ? tailRate : 44_100, channels: 2)

    for node in [vocalsRate, instrumentalRate, vocalsGain, instrumentalGain, sum, equalizer]
      as [AVAudioNode] {
      engine.disconnectNodeInput(node)
    }
    engine.disconnectNodeInput(engine.mainMixerNode)

    engine.connect(vocalsPlayer, to: vocalsRate, fromBus: 0, toBus: 0, format: vocalsFormat)
    engine.connect(vocalsRate, to: vocalsGain, fromBus: 0, toBus: 0, format: vocalsFormat)
    engine.connect(vocalsGain, to: sum, fromBus: 0, toBus: 0, format: tailFormat)

    engine.connect(
      instrumentalPlayer, to: instrumentalRate, fromBus: 0, toBus: 0, format: instrumentalFormat
    )
    engine.connect(
      instrumentalRate, to: instrumentalGain, fromBus: 0, toBus: 0, format: instrumentalFormat
    )
    engine.connect(instrumentalGain, to: sum, fromBus: 0, toBus: 1, format: tailFormat)

    engine.connect(sum, to: equalizer, fromBus: 0, toBus: 0, format: tailFormat)
    engine.connect(equalizer, to: engine.mainMixerNode, fromBus: 0, toBus: 0, format: tailFormat)
  }
}

// MARK: - The mixer

private final class StemMixer {
  /// Every graph mutation is serialised here. AVAudioPlayerNode.stop() may
  /// block until the render callbacks drain, so it must never run on the JS
  /// thread; status reads deliberately do NOT use this queue (see `snapshot`).
  private let queue = DispatchQueue(label: "pt.omelhorsite.omsnative.stemmixer")

  /// Guards only the scalars the status path reads, held for microseconds.
  private let lock = NSLock()

  private var graph = MixerGraph()
  private var vocalsFile: AVAudioFile?
  private var instrumentalFile: AVAudioFile?

  // Shared with the status path, always under `lock`.
  private var prepared = false
  private var desiredPlaying = false
  private var scheduleOffset: Double = 0
  private var durationSeconds: Double = 0
  private var lastError: String?

  // Cached knobs. Remembered while the mixer is idle so a prepare never plays
  // one tick at the wrong level (web parity: gains are live AudioParam writes).
  private var vocalGain: Double = 1
  private var instrumentalGain: Double = 1
  private var masterGain: Double = 1
  private var eqLow: Double = 0
  private var eqMid: Double = 0
  private var eqHigh: Double = 0
  private var eqEnabled = false
  private var rate: Double = 1

  private var observers: [NSObjectProtocol] = []

  /// Set by the module; fires on every state transition, never on a timer.
  var onStatus: (([String: Any?]) -> Void)?

  init() {
    observe()
  }

  deinit {
    for observer in observers {
      NotificationCenter.default.removeObserver(observer)
    }
  }

  // MARK: Public surface (all thread-safe)

  func prepare(vocalsUri: String, instrumentalUri: String, startSeconds: Double) throws {
    let vocalsUrl = try localFileUrl(from: vocalsUri)
    let instrumentalUrl = try localFileUrl(from: instrumentalUri)

    // Opening the files is the expensive, throwing part; do it BEFORE touching
    // the graph so a bad stem leaves the previous state exactly as it was and
    // the caller can keep the plain mix.
    let vocals = try openFile(at: vocalsUrl)
    let instrumental = try openFile(at: instrumentalUrl)

    // The stems are separated from the COMPRESSED mix, so their length can
    // differ from song.duration and from each other by a frame or two. The
    // shorter one bounds the blend: past it one stem would play alone.
    let duration = min(seconds(of: vocals), seconds(of: instrumental))

    queue.sync {
      self.teardownLocked()
      self.vocalsFile = vocals
      self.instrumentalFile = instrumental
      self.graph.connect(
        vocalsFormat: vocals.processingFormat,
        instrumentalFormat: instrumental.processingFormat
      )
      self.applyGainsLocked()
      self.applyEqLocked()
      self.applyRateLocked()

      let start = clamp(startSeconds, 0, duration)
      self.write {
        self.prepared = true
        self.desiredPlaying = false
        self.durationSeconds = duration
        self.scheduleOffset = start
        self.lastError = nil
      }
      // Warm the decoders now so the first play only pays the lead time.
      self.scheduleLocked(from: start)
    }
    emitStatus()
  }

  func play() {
    queue.async {
      guard self.read({ self.prepared }) else {
        return
      }
      if self.read({ self.desiredPlaying }) && self.graph.vocalsPlayer.isPlaying {
        return
      }
      let resumeFrom = self.read { self.scheduleOffset }
      let duration = self.read { self.durationSeconds }
      guard resumeFrom < duration else {
        return
      }
      self.write { self.desiredPlaying = true }
      self.startLocked(from: resumeFrom)
      self.emitStatus()
    }
  }

  func pause() {
    queue.async {
      guard self.read({ self.prepared }) else {
        return
      }
      let position = self.currentPosition()
      self.graph.vocalsPlayer.stop()
      self.graph.instrumentalPlayer.stop()
      self.write {
        self.desiredPlaying = false
        self.scheduleOffset = min(position, self.durationSeconds)
      }
      // The muted AVPlayer is paused too, so the hardware has nothing to do.
      self.graph.engine.pause()
      self.emitStatus()
    }
  }

  func seek(to seconds: Double) {
    queue.async {
      guard self.read({ self.prepared }) else {
        return
      }
      let target = clamp(seconds, 0, self.read { self.durationSeconds })
      if self.read({ self.desiredPlaying }) {
        self.startLocked(from: target)
      } else {
        self.graph.vocalsPlayer.stop()
        self.graph.instrumentalPlayer.stop()
        self.write { self.scheduleOffset = target }
        self.scheduleLocked(from: target)
      }
      self.emitStatus()
    }
  }

  func setGains(vocal: Double, instrumental: Double, master: Double) {
    queue.async {
      self.vocalGain = clamp(vocal, 0, 1)
      self.instrumentalGain = clamp(instrumental, 0, 1)
      self.masterGain = clamp(master, 0, 1)
      self.applyGainsLocked()
    }
  }

  func setEq(low: Double, mid: Double, high: Double, enabled: Bool) {
    queue.async {
      self.eqLow = clamp(low, eqMinDb, eqMaxDb)
      self.eqMid = clamp(mid, eqMinDb, eqMaxDb)
      self.eqHigh = clamp(high, eqMinDb, eqMaxDb)
      self.eqEnabled = enabled
      self.applyEqLocked()
    }
  }

  func setRate(_ next: Double) {
    queue.async {
      self.rate = clamp(next, rateMin, rateMax)
      self.applyRateLocked()
    }
  }

  /// Drift safety. Returns the measured (mixer - reference) offset in seconds
  /// and, when it exceeds `tolerance`, re-pairs both stems onto the reference.
  /// Structure keeps the two stems locked to each other; only their common
  /// offset from the muted AVPlayer can wander, and only this can see it.
  @discardableResult
  func resync(referenceSeconds: Double, toleranceSeconds: Double) -> Double {
    guard read({ prepared }) else {
      return 0
    }
    let drift = currentPosition() - referenceSeconds
    guard read({ desiredPlaying }), abs(drift) > max(0, toleranceSeconds) else {
      return drift
    }
    seek(to: referenceSeconds)
    return drift
  }

  func release() {
    queue.async {
      self.teardownLocked()
      self.emitStatus()
    }
  }

  func snapshot() -> [String: Any?] {
    let position = currentPosition()
    return withState { () -> [String: Any?] in
      [
        "currentTime": position,
        "duration": durationSeconds,
        "playing": desiredPlaying,
        "prepared": prepared,
        "error": lastError
      ]
    }
  }

  // MARK: Position

  /// Live position in FILE seconds. Safe from any thread: AVAudioPlayerNode
  /// synchronises its own timing accessors internally (AVAudioPlayerNode.h:75).
  private func currentPosition() -> Double {
    let (offset, duration, playing) = withState { () -> (Double, Double, Bool) in
      (scheduleOffset, durationSeconds, desiredPlaying)
    }
    guard playing else {
      return offset
    }
    // Through the lock: a media-services reset swaps the whole graph, and this
    // is the one accessor that runs off the serial queue.
    let player = withState { graph }.vocalsPlayer
    guard
      let nodeTime = player.lastRenderTime,
      let playerTime = player.playerTime(forNodeTime: nodeTime),
      playerTime.sampleRate > 0
    else {
      return offset
    }
    // Negative until the shared start instant arrives; clamped so the position
    // never walks backwards through the lead window.
    let elapsed = max(0, Double(playerTime.sampleTime) / playerTime.sampleRate)
    return min(duration, offset + elapsed)
  }

  // MARK: Transport internals (queue only)

  /// One schedule pair. `at: nil` means "player timeline zero"; the shared
  /// start instant goes into `playAtTime:` instead, so a single AVAudioTime
  /// governs both nodes and neither can land a cycle early.
  private func scheduleLocked(from seconds: Double) {
    guard let vocals = vocalsFile, let instrumental = instrumentalFile else {
      return
    }
    graph.vocalsPlayer.stop()
    graph.instrumentalPlayer.stop()

    guard
      let vocalsSegment = segment(of: vocals, from: seconds),
      let instrumentalSegment = segment(of: instrumental, from: seconds)
    else {
      return
    }

    graph.vocalsPlayer.scheduleSegment(
      vocals,
      startingFrame: vocalsSegment.start,
      frameCount: vocalsSegment.count,
      at: nil,
      completionHandler: nil
    )
    graph.instrumentalPlayer.scheduleSegment(
      instrumental,
      startingFrame: instrumentalSegment.start,
      frameCount: instrumentalSegment.count,
      at: nil,
      completionHandler: nil
    )

    let warmup = AVAudioFrameCount(vocals.processingFormat.sampleRate / 10)
    graph.vocalsPlayer.prepare(withFrameCount: warmup)
    graph.instrumentalPlayer.prepare(withFrameCount: warmup)
  }

  /// Schedule + start as one operation. `seconds` is where the blend must be
  /// AUDIBLE at the moment sound starts, so the lead is folded into the file
  /// offset: the reference player keeps advancing during those milliseconds
  /// and would otherwise be exactly one lead ahead of us forever.
  private func startLocked(from seconds: Double) {
    let lead = leadSeconds()
    let duration = read { durationSeconds }
    let offset = min(seconds + lead, duration)

    guard startEngineLocked() else {
      return
    }
    write { scheduleOffset = offset }
    scheduleLocked(from: offset)

    let when = AVAudioTime(hostTime: mach_absolute_time() + AVAudioTime.hostTime(forSeconds: lead))
    graph.vocalsPlayer.play(at: when)
    graph.instrumentalPlayer.play(at: when)
  }

  /// The one place the engine is started. A failure is reported, never thrown:
  /// the caller (JS) then falls back to the plain mix, which is still playing.
  @discardableResult
  private func startEngineLocked() -> Bool {
    if graph.engine.isRunning {
      return true
    }
    graph.engine.prepare()
    do {
      try graph.engine.start()
      return true
    } catch {
      // Only recovery worth attempting: the session went inactive while both
      // players were paused. setActive(true) is a no-op on an already-active
      // session and cannot disturb expo-audio's AVPlayer; setActive(FALSE) is
      // never called anywhere in this module, because that one would.
      try? AVAudioSession.sharedInstance().setActive(true)
      do {
        try graph.engine.start()
        return true
      } catch {
        write { lastError = error.localizedDescription }
        return false
      }
    }
  }

  private func leadSeconds() -> Double {
    let ioBuffer = AVAudioSession.sharedInstance().ioBufferDuration
    let lead = ioBuffer > 0 ? ioBuffer * 2 : minimumLeadSeconds
    return clamp(lead, minimumLeadSeconds, maximumLeadSeconds)
  }

  private func teardownLocked() {
    graph.vocalsPlayer.stop()
    graph.instrumentalPlayer.stop()
    graph.engine.stop()
    vocalsFile = nil
    instrumentalFile = nil
    write {
      prepared = false
      desiredPlaying = false
      scheduleOffset = 0
      durationSeconds = 0
    }
  }

  // MARK: Parameter application (queue only)

  private func applyGainsLocked() {
    graph.vocalsGain.outputVolume = Float(vocalGain)
    graph.instrumentalGain.outputVolume = Float(instrumentalGain)
    graph.engine.mainMixerNode.outputVolume = Float(masterGain)
  }

  private func applyEqLocked() {
    let gains = [eqLow, eqMid, eqHigh]
    var anyActive = false
    for (index, gain) in gains.enumerated() where index < graph.equalizer.bands.count {
      let band = graph.equalizer.bands[index]
      band.gain = Float(gain)
      // FR-70: a flat band is bypassed, so a flat EQ costs nothing at all.
      let active = eqEnabled && gain != 0
      band.bypass = !active
      anyActive = anyActive || active
    }
    graph.equalizer.bypass = !anyActive
  }

  private func applyRateLocked() {
    graph.vocalsRate.rate = Float(rate)
    graph.instrumentalRate.rate = Float(rate)
  }

  // MARK: Files

  private func openFile(at url: URL) throws -> AVAudioFile {
    guard FileManager.default.fileExists(atPath: url.path) else {
      throw StemFileMissingException(url.path)
    }
    let file: AVAudioFile
    do {
      file = try AVAudioFile(forReading: url)
    } catch {
      throw StemFileUnreadableException("\(url.lastPathComponent): \(error.localizedDescription)")
    }
    guard file.length > 0, file.processingFormat.sampleRate > 0 else {
      throw StemFileEmptyException(url.lastPathComponent)
    }
    return file
  }

  private func seconds(of file: AVAudioFile) -> Double {
    Double(file.length) / file.processingFormat.sampleRate
  }

  private func segment(
    of file: AVAudioFile,
    from seconds: Double
  ) -> (start: AVAudioFramePosition, count: AVAudioFrameCount)? {
    let sampleRate = file.processingFormat.sampleRate
    let start = AVAudioFramePosition(max(0, seconds) * sampleRate)
    guard start < file.length else {
      return nil
    }
    return (start, AVAudioFrameCount(file.length - start))
  }

  // MARK: Notifications

  private func observe() {
    let center = NotificationCenter.default

    // Route change / hardware reconfiguration: the engine stops and every
    // connection that derived its format from the hardware is stale.
    observers.append(
      center.addObserver(
        forName: .AVAudioEngineConfigurationChange,
        object: nil,
        queue: nil
      ) { [weak self] notification in
        self?.handleConfigurationChange(engine: notification.object as? AVAudioEngine)
      }
    )

    observers.append(
      center.addObserver(
        forName: AVAudioSession.interruptionNotification,
        object: nil,
        queue: nil
      ) { [weak self] notification in
        self?.handleInterruption(notification)
      }
    )

    // Media services reset invalidates the engine and every node in it; the
    // only supported recovery is to throw the whole graph away.
    observers.append(
      center.addObserver(
        forName: AVAudioSession.mediaServicesWereResetNotification,
        object: nil,
        queue: nil
      ) { [weak self] _ in
        self?.handleMediaServicesReset()
      }
    )
  }

  private func handleConfigurationChange(engine: AVAudioEngine?) {
    queue.async {
      // Another engine in the process (expo-audio has none, but a future
      // module might) must not make us rewire ourselves.
      guard engine === nil || engine === self.graph.engine else {
        return
      }
      guard self.read({ self.prepared }),
        let vocals = self.vocalsFile,
        let instrumental = self.instrumentalFile
      else {
        return
      }
      let resumeFrom = self.currentPosition()
      let wasPlaying = self.read { self.desiredPlaying }
      self.graph.vocalsPlayer.stop()
      self.graph.instrumentalPlayer.stop()
      self.graph.engine.stop()
      self.graph.connect(
        vocalsFormat: vocals.processingFormat,
        instrumentalFormat: instrumental.processingFormat
      )
      self.applyGainsLocked()
      self.applyEqLocked()
      self.applyRateLocked()
      self.write { self.scheduleOffset = resumeFrom }
      if wasPlaying {
        self.startLocked(from: resumeFrom)
      } else {
        self.scheduleLocked(from: resumeFrom)
      }
      self.emitStatus()
    }
  }

  /// An interruption stops the engine under us. Freeze honestly at the current
  /// position and report `playing: false`: JS drives the resume through the
  /// same play() the muted AVPlayer gets, so the two come back together.
  private func handleInterruption(_ notification: Notification) {
    guard
      let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
      let type = AVAudioSession.InterruptionType(rawValue: raw),
      type == .began
    else {
      return
    }
    queue.async {
      guard self.read({ self.prepared }), self.read({ self.desiredPlaying }) else {
        return
      }
      let position = self.currentPosition()
      self.graph.vocalsPlayer.stop()
      self.graph.instrumentalPlayer.stop()
      self.graph.engine.pause()
      self.write {
        self.desiredPlaying = false
        self.scheduleOffset = min(position, self.durationSeconds)
      }
      self.emitStatus()
    }
  }

  private func handleMediaServicesReset() {
    queue.async {
      self.teardownLocked()
      self.write {
        self.graph = MixerGraph()
        self.lastError = "Media services were reset"
      }
      self.emitStatus()
    }
  }

  // MARK: Small helpers

  /// The ONE way the scalars shared with the status path are touched.
  private func withState<T>(_ body: () -> T) -> T {
    lock.lock()
    defer { lock.unlock() }
    return body()
  }

  private func read<T>(_ body: () -> T) -> T {
    withState(body)
  }

  private func write(_ body: () -> Void) {
    withState(body)
  }

  private func emitStatus() {
    onStatus?(snapshot())
  }
}

// MARK: - Module

public final class OmsStemMixerModule: Module {
  private let mixer = StemMixer()

  public func definition() -> ModuleDefinition {
    Name("OmsStemMixer")

    Events(statusEvent)

    OnCreate {
      self.mixer.onStatus = { [weak self] payload in
        self?.sendEvent(statusEvent, payload)
      }
    }

    // Async because opening two AVAudioFiles hits the filesystem and decodes
    // headers. Rejects when either stem is remote, missing, unreadable or
    // empty - the caller then stays on the plain mix, never a half mix.
    AsyncFunction("prepare") { (vocalsUri: String, instrumentalUri: String, startSeconds: Double) in
      try self.mixer.prepare(
        vocalsUri: vocalsUri,
        instrumentalUri: instrumentalUri,
        startSeconds: startSeconds
      )
    }

    Function("play") {
      self.mixer.play()
    }

    Function("pause") {
      self.mixer.pause()
    }

    Function("seek") { (seconds: Double) in
      self.mixer.seek(to: seconds)
    }

    Function("setGains") { (vocal: Double, instrumental: Double, master: Double) in
      self.mixer.setGains(vocal: vocal, instrumental: instrumental, master: master)
    }

    Function("setEq") { (low: Double, mid: Double, high: Double, enabled: Bool) in
      self.mixer.setEq(low: low, mid: mid, high: high, enabled: enabled)
    }

    Function("setRate") { (rate: Double) in
      self.mixer.setRate(rate)
    }

    // Synchronous so JS can compare the mixer's clock against the muted
    // reference player inside one status tick, with no extra round trip.
    Function("getStatus") { () -> [String: Any?] in
      self.mixer.snapshot()
    }

    Function("resync") { (referenceSeconds: Double, toleranceSeconds: Double) -> Double in
      self.mixer.resync(referenceSeconds: referenceSeconds, toleranceSeconds: toleranceSeconds)
    }

    Function("release") {
      self.mixer.release()
    }

    OnDestroy {
      self.mixer.onStatus = nil
      self.mixer.release()
    }
  }
}

// MARK: - Free helpers

private func clamp(_ value: Double, _ low: Double, _ high: Double) -> Double {
  guard value.isFinite else {
    return low
  }
  return Swift.min(high, Swift.max(low, value))
}

/// AVAudioFile is local-file-only, so anything that is not a file path is a
/// programming error on the JS side and must fail loudly rather than degrade.
private func localFileUrl(from uri: String) throws -> URL {
  let trimmed = uri.trimmingCharacters(in: .whitespacesAndNewlines)
  guard !trimmed.isEmpty else {
    throw StemUriNotLocalException("(empty)")
  }
  if let parsed = URL(string: trimmed), let scheme = parsed.scheme?.lowercased() {
    guard scheme == "file" else {
      throw StemUriNotLocalException(trimmed)
    }
    // Rebuilt from the decoded path: URL(string:) reads a raw "#" or "?" in a
    // filename as a fragment or query and silently drops the tail.
    return URL(fileURLWithPath: parsed.path)
  }
  guard trimmed.hasPrefix("/") else {
    throw StemUriNotLocalException(trimmed)
  }
  return URL(fileURLWithPath: trimmed)
}
