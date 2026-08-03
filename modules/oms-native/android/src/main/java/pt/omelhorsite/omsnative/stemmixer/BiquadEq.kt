package pt.omelhorsite.omsnative.stemmixer

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * The 3-band EQ of the custom blend, transcribed from the Web Audio
 * `BiquadFilterNode` definitions so the native mix sounds identical to the web
 * player (frontend/lib/audioEqualizer.ts: lowshelf 120 Hz, peaking 1000 Hz
 * Q = 1, highshelf 8000 Hz, every band clamped -12..+12 dB, default 0 dB).
 *
 * Web Audio implements those filter types with the Audio EQ Cookbook
 * (RBJ) coefficients, and the shelves ignore `Q` entirely - the spec pins the
 * shelf slope at S = 1, which is why `setLowShelf` / `setHighShelf` take no Q.
 * The peaking band is the only one that uses it, and the web pins it at 1.
 */
internal object EqSpec {
  const val LOW_SHELF_HZ = 120.0
  const val MID_PEAK_HZ = 1000.0
  const val MID_Q = 1.0
  const val HIGH_SHELF_HZ = 8000.0
  const val MIN_DB = -12.0
  const val MAX_DB = 12.0

  /** NaN reads as flat, exactly like `clampEqDb` in player/gainLaw.ts. */
  fun clampDb(db: Double): Double = if (db.isNaN()) 0.0 else db.coerceIn(MIN_DB, MAX_DB)
}

/**
 * One Direct-Form-I biquad section, one audio channel. State is kept in
 * `Double` even though the samples are `Float`: at 8 kHz / 44.1 kHz the shelf
 * poles sit close enough to the unit circle that single precision audibly
 * drifts on long tracks.
 */
internal class Biquad {
  private var b0 = 1.0
  private var b1 = 0.0
  private var b2 = 0.0
  private var a1 = 0.0
  private var a2 = 0.0

  private var x1 = 0.0
  private var x2 = 0.0
  private var y1 = 0.0
  private var y2 = 0.0

  /** Drops the filter memory. Called on every seek so a scrub cannot ring. */
  fun reset() {
    x1 = 0.0
    x2 = 0.0
    y1 = 0.0
    y2 = 0.0
  }

  fun process(x: Double): Double {
    val y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
    x2 = x1
    x1 = x
    y2 = y1
    y1 = y
    return y
  }

  fun setLowShelf(frequency: Double, sampleRate: Int, dbGain: Double) {
    val a = 10.0.pow(dbGain / 40.0)
    val w0 = angularFrequency(frequency, sampleRate)
    val cosW0 = cos(w0)
    // S = 1 => sqrt((A + 1/A) * (1/S - 1) + 2) == sqrt(2).
    val alpha = sin(w0) / 2.0 * SHELF_SLOPE_FACTOR
    val twoSqrtAAlpha = 2.0 * sqrt(a) * alpha
    normalise(
      b0 = a * ((a + 1.0) - (a - 1.0) * cosW0 + twoSqrtAAlpha),
      b1 = 2.0 * a * ((a - 1.0) - (a + 1.0) * cosW0),
      b2 = a * ((a + 1.0) - (a - 1.0) * cosW0 - twoSqrtAAlpha),
      a0 = (a + 1.0) + (a - 1.0) * cosW0 + twoSqrtAAlpha,
      a1 = -2.0 * ((a - 1.0) + (a + 1.0) * cosW0),
      a2 = (a + 1.0) + (a - 1.0) * cosW0 - twoSqrtAAlpha,
    )
  }

  fun setHighShelf(frequency: Double, sampleRate: Int, dbGain: Double) {
    val a = 10.0.pow(dbGain / 40.0)
    val w0 = angularFrequency(frequency, sampleRate)
    val cosW0 = cos(w0)
    val alpha = sin(w0) / 2.0 * SHELF_SLOPE_FACTOR
    val twoSqrtAAlpha = 2.0 * sqrt(a) * alpha
    normalise(
      b0 = a * ((a + 1.0) + (a - 1.0) * cosW0 + twoSqrtAAlpha),
      b1 = -2.0 * a * ((a - 1.0) + (a + 1.0) * cosW0),
      b2 = a * ((a + 1.0) + (a - 1.0) * cosW0 - twoSqrtAAlpha),
      a0 = (a + 1.0) - (a - 1.0) * cosW0 + twoSqrtAAlpha,
      a1 = 2.0 * ((a - 1.0) - (a + 1.0) * cosW0),
      a2 = (a + 1.0) - (a - 1.0) * cosW0 - twoSqrtAAlpha,
    )
  }

  fun setPeaking(frequency: Double, sampleRate: Int, q: Double, dbGain: Double) {
    val a = 10.0.pow(dbGain / 40.0)
    val w0 = angularFrequency(frequency, sampleRate)
    val cosW0 = cos(w0)
    val alpha = sin(w0) / (2.0 * q)
    normalise(
      b0 = 1.0 + alpha * a,
      b1 = -2.0 * cosW0,
      b2 = 1.0 - alpha * a,
      a0 = 1.0 + alpha / a,
      a1 = -2.0 * cosW0,
      a2 = 1.0 - alpha / a,
    )
  }

  private fun normalise(b0: Double, b1: Double, b2: Double, a0: Double, a1: Double, a2: Double) {
    this.b0 = b0 / a0
    this.b1 = b1 / a0
    this.b2 = b2 / a0
    this.a1 = a1 / a0
    this.a2 = a2 / a0
  }

  private companion object {
    val SHELF_SLOPE_FACTOR = sqrt(2.0)

    /**
     * A shelf at 8 kHz on a 16 kHz stem would sit on Nyquist and produce a
     * degenerate section, so the corner is clamped just below it - the same
     * thing Web Audio does when the frequency exceeds the Nyquist limit.
     */
    fun angularFrequency(frequency: Double, sampleRate: Int): Double {
      val nyquistLimited = frequency.coerceAtMost(sampleRate * 0.49)
      return 2.0 * PI * nyquistLimited / sampleRate
    }
  }
}

/**
 * Three biquads in series (low -> mid -> high), per channel, exactly the order
 * the web chains them in. Interleaved stereo in place.
 */
internal class EqChain(private val sampleRate: Int) {
  private val filters = Array(CHANNELS) { Array(BANDS) { Biquad() } }

  private var lowDb = 0.0
  private var midDb = 0.0
  private var highDb = 0.0

  /** Every band at 0 dB: the mixer skips the filter loop entirely (FR-70). */
  var isFlat = true
    private set

  fun setBands(low: Double, mid: Double, high: Double) {
    val l = EqSpec.clampDb(low)
    val m = EqSpec.clampDb(mid)
    val h = EqSpec.clampDb(high)
    if (l == lowDb && m == midDb && h == highDb) return
    lowDb = l
    midDb = m
    highDb = h
    isFlat = l == 0.0 && m == 0.0 && h == 0.0
    for (channel in 0 until CHANNELS) {
      val chain = filters[channel]
      chain[0].setLowShelf(EqSpec.LOW_SHELF_HZ, sampleRate, l)
      chain[1].setPeaking(EqSpec.MID_PEAK_HZ, sampleRate, EqSpec.MID_Q, m)
      chain[2].setHighShelf(EqSpec.HIGH_SHELF_HZ, sampleRate, h)
    }
  }

  fun reset() {
    for (channel in 0 until CHANNELS) {
      for (band in 0 until BANDS) filters[channel][band].reset()
    }
  }

  fun process(buffer: FloatArray, frames: Int) {
    for (channel in 0 until CHANNELS) {
      val chain = filters[channel]
      val low = chain[0]
      val mid = chain[1]
      val high = chain[2]
      var index = channel
      var frame = 0
      while (frame < frames) {
        val filtered = high.process(mid.process(low.process(buffer[index].toDouble())))
        buffer[index] = filtered.toFloat()
        index += CHANNELS
        frame++
      }
    }
  }

  private companion object {
    const val CHANNELS = 2
    const val BANDS = 3
  }
}
