package pt.omelhorsite.omsnative.stemmixer

/**
 * Turns one [StemDecoder] into a stream of OUTPUT-rate stereo frames.
 *
 * The mixer asks both readers for the same number of output frames per block,
 * and each reader consumes `ratio` source frames per output frame, where
 *
 *   ratio = stemSampleRate / outputSampleRate * playbackRate
 *
 * so both stems advance by exactly the same amount of MEDIA time per block no
 * matter what their own sample rates are. That is what makes stems with
 * different rates (or a rate change mid-track) safe: the two stems can never
 * consume different amounts of media.
 *
 * `playbackRate` is folded into the ratio on purpose. FR-64 wants the pitch to
 * move with the rate (no time stretching), which is exactly what plain
 * resampling does, and doing it here rather than through
 * `AudioTrack.setPlaybackParams` keeps ONE definition of "how much media has
 * been written", so the reported position stays honest across rate changes.
 *
 * There is exactly one buffering path (no separate ratio == 1 shortcut) so the
 * two readers always hold identical amounts of buffered audio. With `frac`
 * pinned at 0 the interpolation returns the source frame bit-exactly, so
 * playing at 1.0x is passthrough anyway.
 */
internal class StemReader(private val decoder: StemDecoder) {
  private val chunk = FloatArray(CHUNK_FRAMES * STEREO)
  private var chunkFrames = 0
  private var chunkPosition = 0

  private var pulledLeft = 0.0f
  private var pulledRight = 0.0f

  private var currentLeft = 0.0f
  private var currentRight = 0.0f
  private var nextLeft = 0.0f
  private var nextRight = 0.0f

  private var windowLoaded = false
  private var sourceDone = false
  private var exhausted = false
  private var fraction = 0.0

  /** True once the stem has nothing left; the mixer zero-fills its share. */
  val isExhausted: Boolean
    get() = exhausted

  /** Drops every buffered frame. Called after the decoder seeks. */
  fun reset() {
    chunkFrames = 0
    chunkPosition = 0
    windowLoaded = false
    sourceDone = false
    exhausted = false
    fraction = 0.0
  }

  /** Writes up to [frames] interleaved stereo frames; returns how many. */
  fun read(out: FloatArray, frames: Int, ratio: Double): Int {
    var produced = 0
    while (produced < frames) {
      if (!loadWindow()) break
      val weight = fraction.toFloat()
      val index = produced * STEREO
      out[index] = currentLeft + (nextLeft - currentLeft) * weight
      out[index + 1] = currentRight + (nextRight - currentRight) * weight
      produced++
      fraction += ratio
      while (fraction >= 1.0) {
        if (!step()) {
          exhausted = true
          break
        }
        fraction -= 1.0
      }
      if (exhausted) break
    }
    return produced
  }

  private fun loadWindow(): Boolean {
    if (exhausted) return false
    if (windowLoaded) return true
    if (!pullFrame()) {
      exhausted = true
      return false
    }
    currentLeft = pulledLeft
    currentRight = pulledRight
    if (pullFrame()) {
      nextLeft = pulledLeft
      nextRight = pulledRight
    } else {
      // Final frame of the stem: hold it so the interpolation stays valid.
      sourceDone = true
      nextLeft = currentLeft
      nextRight = currentRight
    }
    windowLoaded = true
    return true
  }

  private fun step(): Boolean {
    if (sourceDone) return false
    currentLeft = nextLeft
    currentRight = nextRight
    if (!pullFrame()) {
      sourceDone = true
      return false
    }
    nextLeft = pulledLeft
    nextRight = pulledRight
    return true
  }

  private fun pullFrame(): Boolean {
    if (chunkPosition >= chunkFrames) {
      // A short read from the decoder always means end of stream: the decoder
      // blocks on the codec rather than reporting a transient starve.
      chunkFrames = decoder.read(chunk, CHUNK_FRAMES)
      chunkPosition = 0
      if (chunkFrames <= 0) return false
    }
    val index = chunkPosition * STEREO
    pulledLeft = chunk[index]
    pulledRight = chunk[index + 1]
    chunkPosition++
    return true
  }

  private companion object {
    const val CHUNK_FRAMES = 2048
    const val STEREO = 2
  }
}
