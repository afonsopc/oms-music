package pt.omelhorsite.omsnative.stemmixer

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Process
import android.util.Log
import java.util.Arrays
import java.util.concurrent.TimeUnit
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * The Android custom-blend mixer: two `MediaCodec` decoders feeding ONE
 * `AudioTrack` from a single loop.
 *
 * Why this shape, and not something off the shelf:
 *  - two ExoPlayer instances (or two audio renderers) each own an `AudioSink`
 *    and drift about 20 ms apart (ExoPlayer issue 11317);
 *  - media3's `AudioMixer` only reaches a player through `CompositionPlayer`,
 *    which is `@ExperimentalApi`, does not advertise
 *    `COMMAND_SET_SPEED_AND_PITCH` (so no 0.5x..1.5x, FR-64) and needs a whole
 *    new `Composition` to change a per-source volume, i.e. a graph restart on
 *    every drag of a blend slider;
 *  - Google's own low-latency guidance is to open ONE output stream and mix in
 *    the app.
 * Mixing PCM in one loop makes sync structural: both stems are pulled for the
 * same number of output frames per block, so they cannot drift.
 *
 * This class deliberately owns NO MediaSession and NO notification. expo-audio
 * owns the app's only session and keeps playing the original file muted as the
 * transport clock and the notification owner - the same trick the web plays
 * with `mainGain = 0` (frontend/lib/vocalSeparation.ts). A second session here
 * would produce a competing notification detached from playback.
 *
 * Threading: everything that touches the decoders or the `AudioTrack` runs on
 * the mixer thread. JS-facing calls only write volatile fields and wake it, so
 * a slow or wedged audio path can never stall the JS thread, and teardown
 * always happens on the thread that owns the objects.
 */
internal class StemMixerEngine(private val onStatus: (Map<String, Any?>) -> Unit) {

  private val lifecycle = Any()
  private val transport = ReentrantLock()
  private val wake = transport.newCondition()

  /**
   * The mixer thread, and the ONLY handle the rest of the class keeps on a
   * live session: the thread owns the decoders and the output track outright,
   * so nothing outside it can be tempted to touch them.
   */
  private var thread: Thread? = null

  @Volatile private var running = false
  @Volatile private var playing = false
  @Volatile private var prepared = false
  @Volatile private var ended = false
  @Volatile private var pendingSeekUs = NO_SEEK

  @Volatile private var vocalGain = 1.0f
  @Volatile private var instrumentalGain = 1.0f
  @Volatile private var masterGain = 1.0f
  @Volatile private var rate = 1.0

  @Volatile private var eqLowDb = 0.0
  @Volatile private var eqMidDb = 0.0
  @Volatile private var eqHighDb = 0.0
  @Volatile private var eqEnabled = false
  @Volatile private var eqDirty = true

  @Volatile private var positionSeconds = 0.0
  @Volatile private var durationSeconds = 0.0
  @Volatile private var lastError: String? = null

  /**
   * Opens both stems, builds the output track and parks the mixer paused at
   * [startSeconds]. Throws when either file cannot be decoded, so the caller
   * keeps the plain mix instead of playing half of one.
   */
  fun prepare(vocalsPath: String, instrumentalPath: String, startSeconds: Double) {
    synchronized(lifecycle) {
      joinWorkerLocked()
      lastError = null
      prepared = false
      ended = false
      durationSeconds = 0.0

      var vocals: StemDecoder? = null
      var instrumental: StemDecoder? = null
      var track: AudioTrack? = null
      try {
        vocals = StemDecoder.open(vocalsPath, "vocals")
        instrumental = StemDecoder.open(instrumentalPath, "instrumental")

        val outputSampleRate = vocals.sampleRate
        if (instrumental.sampleRate != outputSampleRate) {
          // Not a failure: the readers resample onto one output clock. It does
          // mean the stems were not produced by the same encode, so say so.
          Log.w(
            TAG,
            "Stem sample rates differ (vocals ${vocals.sampleRate} Hz, " +
              "instrumental ${instrumental.sampleRate} Hz); resampling onto $outputSampleRate Hz",
          )
        }
        track = buildTrack(outputSampleRate)

        val next = Session(vocals, instrumental, track, outputSampleRate)
        val startUs = (max(0.0, startSeconds) * MICROS_PER_SECOND).toLong()
        next.applySeek(startUs)
        positionSeconds = startUs / MICROS_PER_SECOND
        durationSeconds = next.durationSeconds

        eqDirty = true
        playing = false
        running = true
        prepared = true
        thread = Thread({ runLoop(next) }, THREAD_NAME).also { it.start() }
      } catch (t: Throwable) {
        track?.let { runCatching { it.release() } }
        instrumental?.close()
        vocals?.close()
        running = false
        prepared = false
        throw t
      }
    }
  }

  fun play() {
    if (!running) return
    playing = true
    signal()
  }

  fun pause() {
    playing = false
    signal()
  }

  /** Repositions BOTH stems to the same offset, one restart, no drift. */
  fun seek(seconds: Double) {
    if (!running) return
    val target = max(0.0, seconds)
    pendingSeekUs = (target * MICROS_PER_SECOND).toLong()
    positionSeconds = target
    signal()
  }

  /** Live parameter write: applied on the next block, never a restart. */
  fun setGains(vocal: Double, instrumental: Double, master: Double) {
    vocalGain = clampUnit(vocal)
    instrumentalGain = clampUnit(instrumental)
    masterGain = clampUnit(master)
  }

  /** Bands in dB; `enabled == false` bypasses the filters entirely. */
  fun setEq(low: Double, mid: Double, high: Double, enabled: Boolean) {
    eqLowDb = low
    eqMidDb = mid
    eqHighDb = high
    eqEnabled = enabled
    eqDirty = true
  }

  fun setRate(value: Double) {
    rate = if (value.isNaN() || value <= 0.0) 1.0 else value.coerceIn(MIN_RATE, MAX_RATE)
  }

  /**
   * Structure keeps the two STEMS locked to each other; it says nothing about
   * the muted original, whose own resume latency this module cannot observe.
   * Returns the drift in seconds (mixer minus reference) and re-seeks only
   * when it is both playing and past [toleranceSeconds].
   */
  fun resync(referenceSeconds: Double, toleranceSeconds: Double): Double {
    if (!prepared) return 0.0
    val drift = positionSeconds - referenceSeconds
    if (!playing || ended || abs(drift) <= max(0.0, toleranceSeconds)) return drift
    seek(referenceSeconds)
    return drift
  }

  fun snapshot(): Map<String, Any?> =
    mapOf(
      "currentTime" to positionSeconds,
      "duration" to durationSeconds,
      "playing" to (prepared && playing && !ended && lastError == null),
      "prepared" to prepared,
      "error" to lastError,
    )

  /**
   * Stops both stems and releases the graph. Idempotent, and deliberately does
   * NOT join: the mixer thread tears its own session down, so a wedged codec
   * can never hold the JS thread. [prepare] and [shutdown] do the joining.
   */
  fun release() {
    synchronized(lifecycle) {
      prepared = false
      if (thread == null) return
      running = false
      playing = false
      signal()
    }
  }

  /** Module teardown: stop and actually wait for the thread to be gone. */
  fun shutdown() {
    synchronized(lifecycle) { joinWorkerLocked() }
  }

  private fun joinWorkerLocked() {
    val worker = thread ?: return
    running = false
    playing = false
    prepared = false
    signal()
    runCatching { worker.join(JOIN_TIMEOUT_MS) }
    if (worker.isAlive) {
      // The loop owns the AudioTrack and the codecs; touching them from here
      // while it is still inside a write is a native crash. Leaking is worse
      // than nothing but strictly better than that, and it cannot happen
      // unless a codec wedged past its own decode budget.
      Log.e(TAG, "Mixer thread did not stop within $JOIN_TIMEOUT_MS ms")
    }
    thread = null
  }

  private fun signal() {
    transport.withLock { wake.signalAll() }
  }

  // ------------------------------------------------------------- mixer thread

  private fun runLoop(session: Session) {
    Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
    var trackPlaying = false
    var idle = false
    var lastEmit = 0L
    try {
      while (running) {
        val seekUs = pendingSeekUs
        if (seekUs != NO_SEEK) {
          pendingSeekUs = NO_SEEK
          if (trackPlaying) {
            session.track.pause()
            trackPlaying = false
          }
          // flush() is a no-op on a playing track, hence the pause above.
          session.track.flush()
          session.applySeek(seekUs)
          positionSeconds = seekUs / MICROS_PER_SECOND
          ended = false
          idle = false
          lastEmit = 0L
        }

        if (!playing || ended) {
          if (trackPlaying) {
            session.track.pause()
            trackPlaying = false
          }
          // One event per transition: a parked mixer must not spam the bridge.
          if (!idle) {
            idle = true
            emit()
          }
          transport.withLock {
            if (running && pendingSeekUs == NO_SEEK && (!playing || ended)) {
              wake.await(PARK_MS, TimeUnit.MILLISECONDS)
            }
          }
          continue
        }
        idle = false

        if (!trackPlaying) {
          session.track.play()
          trackPlaying = true
        }

        if (eqDirty) {
          eqDirty = false
          // Coefficients change live; the filter memory is deliberately NOT
          // reset here, because dropping it mid-drag is an audible click.
          if (eqEnabled) {
            session.eq.setBands(eqLowDb, eqMidDb, eqHighDb)
          } else {
            session.eq.setBands(0.0, 0.0, 0.0)
          }
        }

        if (session.pendingFloats == 0) {
          session.renderBlock(rate, vocalGain, instrumentalGain, masterGain)
        }
        if (session.pendingFloats == 0) {
          // Both stems are done: go quiet and let the muted original, which is
          // the real clock, drive the end of the track.
          ended = true
          continue
        }
        writePending(session)
        updatePosition(session)

        val now = System.currentTimeMillis()
        if (now - lastEmit >= STATUS_INTERVAL_MS) {
          lastEmit = now
          emit()
        }
      }
    } catch (t: Throwable) {
      lastError = t.message ?: t.javaClass.simpleName
      playing = false
      prepared = false
      Log.e(TAG, "Stem mixer failed", t)
      emit()
    } finally {
      runCatching { session.track.pause() }
      runCatching { session.track.flush() }
      runCatching { session.track.release() }
      session.close()
    }
  }

  /**
   * Hands the rendered block to the track WITHOUT blocking: a blocking write
   * on a paused track would never return, and teardown has to be able to join
   * this thread. Whatever the track refuses stays pending, so pausing mid-block
   * loses no audio and cannot shift one stem against the other.
   */
  private fun writePending(session: Session) {
    while (session.pendingOffset < session.pendingFloats) {
      if (!running || !playing || pendingSeekUs != NO_SEEK) return
      val written =
        session.track.write(
          session.mix,
          session.pendingOffset,
          session.pendingFloats - session.pendingOffset,
          AudioTrack.WRITE_NON_BLOCKING,
        )
      if (written < 0) throw IllegalStateException("AudioTrack.write failed ($written)")
      session.pendingOffset += written
      if (written == 0) Thread.sleep(WRITE_POLL_MS)
    }
    session.commitPending()
  }

  private fun updatePosition(session: Session) {
    val head = session.track.playbackHeadPosition.toLong() and UNSIGNED_INT_MASK
    val unplayed = (session.outputFramesWritten - head).coerceAtLeast(0L)
    val ahead = unplayed.toDouble() * rate / session.outputSampleRate
    positionSeconds = max(0.0, session.mediaSecondsWritten - ahead)
  }

  private fun emit() {
    onStatus(snapshot())
  }

  private fun buildTrack(sampleRate: Int): AudioTrack {
    val minBytes =
      AudioTrack.getMinBufferSize(
        sampleRate,
        AudioFormat.CHANNEL_OUT_STEREO,
        AudioFormat.ENCODING_PCM_FLOAT,
      )
    if (minBytes <= 0) {
      throw IllegalStateException("No float output at $sampleRate Hz (getMinBufferSize=$minBytes)")
    }
    val targetBytes = (sampleRate * BUFFER_SECONDS).roundToInt() * STEREO * BYTES_PER_FLOAT
    val bufferBytes = max(minBytes * 2, targetBytes)
    val track =
      AudioTrack.Builder()
        .setAudioAttributes(
          AudioAttributes.Builder()
            // Plain media: expo-audio already holds the audio focus for the
            // muted original, so this never asks for its own.
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
            .build(),
        )
        .setAudioFormat(
          AudioFormat.Builder()
            .setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
            .setSampleRate(sampleRate)
            .setChannelMask(AudioFormat.CHANNEL_OUT_STEREO)
            .build(),
        )
        .setBufferSizeInBytes(bufferBytes)
        .setTransferMode(AudioTrack.MODE_STREAM)
        .build()
    if (track.state != AudioTrack.STATE_INITIALIZED) {
      runCatching { track.release() }
      throw IllegalStateException("AudioTrack did not initialise at $sampleRate Hz")
    }
    return track
  }

  /**
   * Everything the mixer thread owns. Built on the Expo async queue and
   * published to the thread by `Thread.start()`, so no extra synchronisation
   * is needed on these fields.
   */
  private class Session(
    private val vocals: StemDecoder,
    private val instrumental: StemDecoder,
    val track: AudioTrack,
    val outputSampleRate: Int,
  ) {
    private val vocalReader = StemReader(vocals)
    private val instrumentalReader = StemReader(instrumental)
    private val vocalBlock = FloatArray(BLOCK_FRAMES * STEREO)
    private val instrumentalBlock = FloatArray(BLOCK_FRAMES * STEREO)

    val eq = EqChain(outputSampleRate)
    val mix = FloatArray(BLOCK_FRAMES * STEREO)

    /** Floats of [mix] that still have to reach the track, and how far in. */
    var pendingFloats = 0
    var pendingOffset = 0
    private var pendingFrames = 0
    private var pendingMediaSeconds = 0.0

    var mediaSecondsWritten = 0.0
    var outputFramesWritten = 0L

    // Applied gains, so a slider drag ramps across the block instead of
    // stepping (a step at a block boundary is an audible click).
    private var appliedVocal = 1.0f
    private var appliedInstrumental = 1.0f
    private var appliedMaster = 1.0f

    val durationSeconds: Double
      get() {
        val v = vocals.durationSeconds
        val i = instrumental.durationSeconds
        if (v > 0.0 && i > 0.0) return min(v, i)
        return max(v, i)
      }

    fun applySeek(positionUs: Long) {
      vocals.seekTo(positionUs)
      instrumental.seekTo(positionUs)
      vocalReader.reset()
      instrumentalReader.reset()
      eq.reset()
      pendingFloats = 0
      pendingOffset = 0
      pendingFrames = 0
      pendingMediaSeconds = 0.0
      mediaSecondsWritten = positionUs / MICROS_PER_SECOND
      outputFramesWritten = 0L
    }

    /**
     * Pulls one block from BOTH stems, mixes, equalises and leaves the result
     * in [mix]. Both readers are asked for the same number of output frames,
     * which is what pins the two stems to one clock.
     */
    fun renderBlock(rate: Double, vocalGain: Float, instrumentalGain: Float, masterGain: Float) {
      val vocalRatio = vocals.sampleRate.toDouble() / outputSampleRate * rate
      val instrumentalRatio = instrumental.sampleRate.toDouble() / outputSampleRate * rate
      val vocalFrames = vocalReader.read(vocalBlock, BLOCK_FRAMES, vocalRatio)
      val instrumentalFrames =
        instrumentalReader.read(instrumentalBlock, BLOCK_FRAMES, instrumentalRatio)
      val frames = max(vocalFrames, instrumentalFrames)
      if (frames == 0) {
        pendingFloats = 0
        pendingOffset = 0
        pendingFrames = 0
        return
      }
      // A stem that ended early contributes silence for the rest of the block.
      Arrays.fill(vocalBlock, vocalFrames * STEREO, frames * STEREO, 0.0f)
      Arrays.fill(instrumentalBlock, instrumentalFrames * STEREO, frames * STEREO, 0.0f)

      val samples = frames * STEREO
      val vocalStep = (vocalGain - appliedVocal) / samples
      val instrumentalStep = (instrumentalGain - appliedInstrumental) / samples
      var v = appliedVocal
      var i = appliedInstrumental
      var index = 0
      while (index < samples) {
        v += vocalStep
        i += instrumentalStep
        mix[index] = vocalBlock[index] * v + instrumentalBlock[index] * i
        index++
      }
      appliedVocal = vocalGain
      appliedInstrumental = instrumentalGain

      // Web parity: stems -> per-stem gain -> EQ -> master gain -> output.
      if (!eq.isFlat) eq.process(mix, frames)

      val masterStep = (masterGain - appliedMaster) / samples
      var m = appliedMaster
      index = 0
      while (index < samples) {
        m += masterStep
        // Hard clip, exactly like the Web Audio destination node.
        mix[index] = (mix[index] * m).coerceIn(-1.0f, 1.0f)
        index++
      }
      appliedMaster = masterGain

      pendingFloats = samples
      pendingOffset = 0
      pendingFrames = frames
      pendingMediaSeconds = frames.toDouble() * rate / outputSampleRate
    }

    /** The whole block reached the track: advance the media clock by it. */
    fun commitPending() {
      mediaSecondsWritten += pendingMediaSeconds
      outputFramesWritten += pendingFrames
      pendingFloats = 0
      pendingOffset = 0
      pendingFrames = 0
      pendingMediaSeconds = 0.0
    }

    fun close() {
      instrumental.close()
      vocals.close()
    }
  }

  private companion object {
    const val TAG = "OmsStemMixer"
    const val THREAD_NAME = "oms-stem-mixer"
    const val NO_SEEK = Long.MIN_VALUE
    const val STEREO = 2
    const val BYTES_PER_FLOAT = 4
    const val BLOCK_FRAMES = 1024
    const val BUFFER_SECONDS = 0.25
    const val STATUS_INTERVAL_MS = 250L
    const val PARK_MS = 200L
    const val WRITE_POLL_MS = 5L

    /**
     * Long enough to outlast the worst case a block can take: two decoder
     * budgets (1.5 s each) plus a write that keeps being refused. Only ever
     * waited on from the Expo async queue, never from JS.
     */
    const val JOIN_TIMEOUT_MS = 4_000L
    const val MIN_RATE = 0.25
    const val MAX_RATE = 4.0
    const val MICROS_PER_SECOND = 1_000_000.0
    const val UNSIGNED_INT_MASK = 0xFFFFFFFFL

    fun clampUnit(value: Double): Float =
      if (value.isNaN()) 0.0f else value.coerceIn(0.0, 1.0).toFloat()
  }
}
