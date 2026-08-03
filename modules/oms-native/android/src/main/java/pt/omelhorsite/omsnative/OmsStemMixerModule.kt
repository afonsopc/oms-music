package pt.omelhorsite.omsnative

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.launch
import pt.omelhorsite.omsnative.stemmixer.StemMixerEngine

/** Every failure crossing the bridge arrives as ERR_STEM_MIXER. */
internal class StemMixerException(message: String, cause: Throwable? = null) :
  CodedException(message, cause)

/**
 * Android half of the custom blend (FR-69 / FR-70, DESIGN 16.A). A second
 * native surface inside the existing `oms-native` module rather than a sibling
 * package: the two halves share one binary, one podspec / gradle pair and one
 * config plugin. The JS surface below is IDENTICAL to the iOS half
 * (ios/OmsStemMixerModule.swift), so the TypeScript wrapper is one shape.
 *
 * WHAT THIS IS NOT: a player. expo-audio keeps the ORIGINAL file loaded and
 * playing throughout custom mode, MUTED by the gain law (`mainGain = 0`). It
 * stays the transport clock, the source of duration / position / ended, and
 * the sole owner of the app's only MediaSession and its notification. That is
 * exactly what frontend/lib/vocalSeparation.ts does on the web, and on Android
 * it is the only workable arrangement: expo-audio's `AudioControlsService`
 * strips the track-navigation commands from every controller that connects and
 * hard-codes its own notification layout on a private `MediaSession`, so a
 * second session published here would produce a competing media notification
 * detached from the real playback. This module only ever produces SOUND, from
 * two local stem files.
 *
 * Engine shape: two `MediaCodec` decoders feeding ONE `AudioTrack` from a
 * single mixing loop, because two ExoPlayers drift ~20 ms (ExoPlayer issue
 * 11317) and media3's mixing `CompositionPlayer` is experimental and drops
 * speed control. See stemmixer/StemMixerEngine.kt.
 *
 * Both stems must already be on local disk: `prepare` takes two `file://` uris
 * (or plain paths) and rejects anything remote or undecodable, so the caller
 * stays on the plain mix rather than playing half a mix.
 */
class OmsStemMixerModule : Module() {
  private val engine = StemMixerEngine { status -> emitStatus(status) }

  override fun definition() = ModuleDefinition {
    Name("OmsStemMixer")

    Events(STATUS_EVENT)

    /**
     * Async because opening two files hits the filesystem and primes two
     * decoders. Rejects when either stem is remote, missing, unreadable or
     * empty - the caller then stays on the plain mix, never a half mix.
     */
    AsyncFunction("prepare") { vocalsUri: String, instrumentalUri: String, startSeconds: Double ->
      try {
        engine.prepare(vocalsUri, instrumentalUri, startSeconds)
      } catch (t: Throwable) {
        throw StemMixerException(t.message ?: "Cannot prepare the stem mixer", t)
      }
    }

    Function("play") { engine.play() }

    Function("pause") { engine.pause() }

    /** Restarts BOTH stems at the same offset: one clock, one start pair. */
    Function("seek") { seconds: Double -> engine.seek(seconds) }

    /**
     * The gain law, verbatim from the web (player/gainLaw.ts): while the stems
     * are on, `master` carries the device volume and the original is muted.
     * Live parameter writes, ramped across one block, never a restart.
     */
    Function("setGains") { vocal: Double, instrumental: Double, master: Double ->
      engine.setGains(vocal, instrumental, master)
    }

    /**
     * Low shelf 120 Hz, mid peaking 1 kHz Q = 1, high shelf 8 kHz, every band
     * clamped -12..+12 dB. `enabled == false` bypasses the filters entirely,
     * so a flat EQ costs nothing in the audio path (FR-70).
     */
    Function("setEq") { low: Double, mid: Double, high: Double, enabled: Boolean ->
      engine.setEq(low, mid, high, enabled)
    }

    /** Rate with the pitch moving with it (FR-64), same value as the original. */
    Function("setRate") { rate: Double -> engine.setRate(rate) }

    /**
     * Synchronous so JS can compare the mixer's clock against the muted
     * reference player inside one status tick, with no extra round trip.
     */
    Function("getStatus") { engine.snapshot() }

    /**
     * Structure keeps the two stems locked to each other; it says nothing
     * about the muted original's own resume latency, which this module cannot
     * observe. Returns the drift in seconds and re-seeks only past tolerance.
     */
    Function("resync") { referenceSeconds: Double, toleranceSeconds: Double ->
      engine.resync(referenceSeconds, toleranceSeconds)
    }

    /**
     * Never joins the mixer thread: that thread owns the codecs and the output
     * track and tears them down itself, so a wedged decoder can stall audio but
     * never the JS thread. `prepare` waits for the previous one before it
     * rebuilds.
     */
    Function("release") { engine.release() }

    OnDestroy { engine.shutdown() }
  }

  /**
   * Events cross into JS from the main thread, the same way expo-audio emits
   * its own status updates; the mixer thread must never touch the runtime.
   */
  private fun emitStatus(status: Map<String, Any?>) {
    val context = runCatching { appContext }.getOrNull() ?: return
    context.mainQueue.launch {
      runCatching { sendEvent(STATUS_EVENT, status) }
    }
  }

  private companion object {
    /** Must stay equal to `statusEvent` in ios/OmsStemMixerModule.swift. */
    const val STATUS_EVENT = "statusUpdate"
  }
}
