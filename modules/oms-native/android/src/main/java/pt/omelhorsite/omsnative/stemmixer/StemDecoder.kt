package pt.omelhorsite.omsnative.stemmixer

import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import android.os.SystemClock
import java.io.Closeable
import java.nio.Buffer
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.min

internal class StemDecodeException(message: String, cause: Throwable? = null) :
  Exception(message, cause)

/**
 * One stem file decoded to interleaved stereo float PCM at its own sample
 * rate, through `MediaExtractor` + `MediaCodec` in SYNCHRONOUS mode.
 *
 * Synchronous is deliberate: the whole point of this mixer is that a single
 * consumer loop pulls from both decoders and writes one `AudioTrack`, so both
 * stems advance by the same frame count per block and cannot drift by
 * construction. Two ExoPlayers, each with its own `AudioSink`, sit about 20 ms
 * apart (ExoPlayer issue 11317), which is exactly what this avoids.
 *
 * Everything here is called from the mixer thread only, except `open` (the
 * Expo async queue) which finishes before that thread starts.
 */
internal class StemDecoder private constructor(
  private val label: String,
  private val extractor: MediaExtractor,
  private val codec: MediaCodec,
  /** Container duration, 0 when the container does not declare one. */
  val durationUs: Long,
) : Closeable {

  /** PCM rate the decoder actually emits (the codec's output format wins). */
  var sampleRate = 0
    private set

  /** Source channel count, 1 or 2; `read` always hands back stereo. */
  var channelCount = 0
    private set

  private var pcmEncoding = AudioFormat.ENCODING_PCM_16BIT
  private var formatLocked = false

  /** Interleaved STEREO float frames waiting to be handed to the mixer. */
  private var pending = FloatArray(0)
  private var pendingFrames = 0
  private var pendingRead = 0

  private val info = MediaCodec.BufferInfo()
  private var inputDone = false
  private var outputDone = false

  /**
   * After a seek the extractor lands on the closest sync frame, which may sit
   * before the requested position. Frames older than the target are dropped so
   * both stems resume from the SAME media time even if their sync grids differ.
   */
  private var discardUntilUs = NO_DISCARD

  val durationSeconds: Double
    get() = if (durationUs > 0L) durationUs / 1_000_000.0 else 0.0

  /**
   * Fills [dst] with up to [frames] interleaved stereo frames and returns how
   * many it produced. A short read means END OF STREAM, never a transient
   * starve: the pump blocks until the codec delivers, so a stem that is simply
   * slow can never slip behind the other one.
   */
  fun read(dst: FloatArray, frames: Int): Int {
    var produced = 0
    while (produced < frames) {
      if (pendingRead >= pendingFrames) {
        if (!pump()) break
        if (pendingRead >= pendingFrames) break
      }
      val take = min(frames - produced, pendingFrames - pendingRead)
      System.arraycopy(pending, pendingRead * STEREO, dst, produced * STEREO, take * STEREO)
      pendingRead += take
      produced += take
    }
    return produced
  }

  /**
   * Repositions to [positionUs] and drops everything decoded before it.
   *
   * PREVIOUS_SYNC, not CLOSEST_SYNC, on purpose: the closest sync frame can
   * sit AFTER the target, and two stems whose sync grids differ would then
   * resume from two different media times - an audible flam. Landing at or
   * before the target and discarding forward makes both stems resume from the
   * same sample.
   */
  fun seekTo(positionUs: Long) {
    val target = positionUs.coerceAtLeast(0L)
    extractor.seekTo(target, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
    // Flushing is also what clears the end-of-stream latch, so a seek back
    // into a finished stem starts decoding again.
    codec.flush()
    inputDone = false
    outputDone = false
    pendingFrames = 0
    pendingRead = 0
    discardUntilUs = target
  }

  override fun close() {
    runCatching { codec.stop() }
    runCatching { codec.release() }
    runCatching { extractor.release() }
  }

  // ---------------------------------------------------------------- decoding

  /** Returns true when it produced new pending frames, false at end of stream. */
  private fun pump(): Boolean {
    if (outputDone && pendingRead >= pendingFrames) return false
    val deadline = SystemClock.uptimeMillis() + PUMP_BUDGET_MS
    while (true) {
      if (!inputDone) feedInput()
      val index = codec.dequeueOutputBuffer(info, DEQUEUE_TIMEOUT_US)
      when {
        index >= 0 -> {
          val endOfStream = (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0
          val codecConfig = (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0
          if (info.size > 0 && !codecConfig) {
            codec.getOutputBuffer(index)?.let { ingest(it) }
          }
          codec.releaseOutputBuffer(index, false)
          if (endOfStream) outputDone = true
          if (pendingRead < pendingFrames) return true
          if (outputDone) return false
        }

        index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> applyFormat(codec.outputFormat)

        index == MediaCodec.INFO_TRY_AGAIN_LATER -> if (outputDone) return false

        // INFO_OUTPUT_BUFFERS_CHANGED is deprecated and irrelevant to
        // getOutputBuffer(index); anything else is simply retried.
        else -> Unit
      }
      if (SystemClock.uptimeMillis() > deadline) {
        throw StemDecodeException("The $label stem decoder stalled")
      }
    }
  }

  private fun feedInput() {
    while (!inputDone) {
      val index = codec.dequeueInputBuffer(0L)
      if (index < 0) return
      val buffer = codec.getInputBuffer(index)
      if (buffer == null) {
        codec.queueInputBuffer(index, 0, 0, 0L, 0)
        return
      }
      (buffer as Buffer).clear()
      val size = extractor.readSampleData(buffer, 0)
      if (size < 0) {
        codec.queueInputBuffer(index, 0, 0, 0L, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
        inputDone = true
        return
      }
      codec.queueInputBuffer(index, 0, size, extractor.sampleTime, 0)
      extractor.advance()
    }
  }

  /** Converts one codec output buffer into interleaved stereo floats. */
  private fun ingest(buffer: ByteBuffer) {
    val nio = buffer as Buffer
    nio.position(info.offset)
    nio.limit(info.offset + info.size)
    buffer.order(ByteOrder.nativeOrder())

    val channels = channelCount
    pendingFrames = 0
    pendingRead = 0
    if (channels <= 0) return

    if (pcmEncoding == AudioFormat.ENCODING_PCM_FLOAT) {
      val src = buffer.asFloatBuffer()
      val frames = src.remaining() / channels
      val skip = leadingDiscard(frames)
      val produce = frames - skip
      if (produce <= 0) return
      ensureCapacity(produce)
      (src as Buffer).position(skip * channels)
      var out = 0
      if (channels == 1) {
        repeat(produce) {
          val sample = src.get()
          pending[out++] = sample
          pending[out++] = sample
        }
      } else {
        repeat(produce) {
          pending[out++] = src.get()
          pending[out++] = src.get()
        }
      }
      pendingFrames = produce
      return
    }

    val src = buffer.asShortBuffer()
    val frames = src.remaining() / channels
    val skip = leadingDiscard(frames)
    val produce = frames - skip
    if (produce <= 0) return
    ensureCapacity(produce)
    (src as Buffer).position(skip * channels)
    var out = 0
    if (channels == 1) {
      repeat(produce) {
        val sample = src.get() / PCM16_SCALE
        pending[out++] = sample
        pending[out++] = sample
      }
    } else {
      repeat(produce) {
        pending[out++] = src.get() / PCM16_SCALE
        pending[out++] = src.get() / PCM16_SCALE
      }
    }
    pendingFrames = produce
  }

  /** Frames of this buffer that precede the seek target, if any. */
  private fun leadingDiscard(frames: Int): Int {
    if (discardUntilUs == NO_DISCARD) return 0
    val delta = discardUntilUs - info.presentationTimeUs
    if (delta <= 0L) {
      discardUntilUs = NO_DISCARD
      return 0
    }
    val skip = (delta * sampleRate / 1_000_000L).toInt()
    // The whole buffer is older than the target: keep discarding.
    if (skip >= frames) return frames
    discardUntilUs = NO_DISCARD
    return skip
  }

  private fun ensureCapacity(frames: Int) {
    val needed = frames * STEREO
    if (pending.size < needed) pending = FloatArray(needed)
  }

  private fun applyFormat(format: MediaFormat) {
    val rate =
      if (format.containsKey(MediaFormat.KEY_SAMPLE_RATE)) {
        format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
      } else {
        0
      }
    val channels =
      if (format.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) {
        format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
      } else {
        0
      }
    // Absent means 16-bit, which is what every software decoder emits.
    val encoding =
      if (format.containsKey(MediaFormat.KEY_PCM_ENCODING)) {
        format.getInteger(MediaFormat.KEY_PCM_ENCODING)
      } else {
        AudioFormat.ENCODING_PCM_16BIT
      }
    if (formatLocked) {
      val changed =
        (rate > 0 && rate != sampleRate) ||
          (channels > 0 && channels != channelCount) ||
          encoding != pcmEncoding
      if (changed) {
        // The AudioTrack is already built around the primed format; carrying
        // on would play garbage, so this fails loudly instead.
        throw StemDecodeException("The $label stem changed PCM format mid-stream")
      }
      return
    }
    if (rate > 0) sampleRate = rate
    if (channels > 0) channelCount = channels
    pcmEncoding = encoding
  }

  /**
   * Decodes the first buffer so the CODEC's own output format (not just the
   * container's) is known before the AudioTrack is built, then refuses
   * anything this mixer cannot honour rather than playing garbage.
   */
  private fun prime() {
    pump()
    if (sampleRate <= 0) {
      throw StemDecodeException("The $label stem declares no sample rate")
    }
    if (channelCount !in 1..MAX_CHANNELS) {
      throw StemDecodeException(
        "The $label stem has $channelCount channels; only mono and stereo are supported",
      )
    }
    if (pcmEncoding != AudioFormat.ENCODING_PCM_16BIT &&
      pcmEncoding != AudioFormat.ENCODING_PCM_FLOAT
    ) {
      throw StemDecodeException("The $label stem decodes to an unsupported PCM encoding")
    }
    if (pendingFrames == 0 && outputDone) {
      throw StemDecodeException("The $label stem decoded to nothing")
    }
    formatLocked = true
  }

  companion object {
    private const val NO_DISCARD = Long.MIN_VALUE
    private const val DEQUEUE_TIMEOUT_US = 5_000L

    /**
     * A local file decodes thousands of times faster than real time, so
     * exceeding this means the codec is wedged: fail loudly rather than let a
     * stem go silently quiet. Kept well under the mixer's join timeout so a
     * wedged decoder still lets the mixer thread be reaped.
     */
    private const val PUMP_BUDGET_MS = 1_500L
    private const val MAX_CHANNELS = 2
    private const val STEREO = 2
    private const val PCM16_SCALE = 32768.0f

    /**
     * Accepts a `file://` uri (what expo-file-system hands out) or a bare
     * path. A remote uri is refused loudly rather than half-streamed: the
     * blend is gated on both stems being resident, and two progressive streams
     * that must never underrun relative to each other are exactly the failure
     * mode this design exists to avoid.
     */
    private fun toLocalPath(raw: String, label: String): String {
      val trimmed = raw.trim()
      if (trimmed.isEmpty()) throw StemDecodeException("The $label stem has no path")
      val uri = Uri.parse(trimmed)
      val scheme = uri.scheme ?: return trimmed
      if (!"file".equals(scheme, ignoreCase = true)) {
        throw StemDecodeException("The $label stem must be a local file, got $scheme:")
      }
      return uri.path ?: trimmed
    }

    fun open(rawPath: String, label: String): StemDecoder {
      val path = toLocalPath(rawPath, label)
      val extractor = MediaExtractor()
      try {
        extractor.setDataSource(path)
      } catch (e: Exception) {
        extractor.release()
        throw StemDecodeException("Cannot open the $label stem", e)
      }

      var trackIndex = -1
      var trackFormat: MediaFormat? = null
      for (index in 0 until extractor.trackCount) {
        val format = extractor.getTrackFormat(index)
        val mime = format.getString(MediaFormat.KEY_MIME) ?: continue
        if (mime.startsWith("audio/")) {
          trackIndex = index
          trackFormat = format
          break
        }
      }
      val format = trackFormat
      if (trackIndex < 0 || format == null) {
        extractor.release()
        throw StemDecodeException("The $label stem has no audio track")
      }
      extractor.selectTrack(trackIndex)

      val mime = format.getString(MediaFormat.KEY_MIME)
      if (mime == null) {
        extractor.release()
        throw StemDecodeException("The $label stem declares no mime type")
      }

      var opened: MediaCodec? = null
      val codec =
        try {
          val created = MediaCodec.createDecoderByType(mime)
          opened = created
          created.configure(format, null, null, 0)
          created.start()
          created
        } catch (e: Exception) {
          opened?.let { runCatching { it.release() } }
          extractor.release()
          throw StemDecodeException("No decoder for the $label stem ($mime)", e)
        }

      val durationUs =
        if (format.containsKey(MediaFormat.KEY_DURATION)) format.getLong(MediaFormat.KEY_DURATION) else 0L
      val decoder = StemDecoder(label, extractor, codec, durationUs)
      decoder.applyFormat(format)
      try {
        decoder.prime()
      } catch (e: Throwable) {
        decoder.close()
        throw e
      }
      return decoder
    }
  }
}
