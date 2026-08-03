/**
 * The custom-blend gain law and the 3-band EQ spec, transcribed VERBATIM from
 * the web so both clients sound identical (DESIGN 16.1 amendment 2026-08-03).
 *
 * Web sources:
 *  - stems OFF: `mainGain = masterVolume`, `masterGain = 1`
 *    (frontend/lib/vocalSeparation.ts:249-250, :266-270);
 *  - stems ON:  `mainGain = 0`, `masterGain = masterVolume`,
 *    `vocalGain = vocalVolume`, `instGain = instrumentalVolume`
 *    (frontend/lib/vocalSeparation.ts:174-186);
 *  - EQ: lowshelf 120 Hz, peaking 1000 Hz Q=1, highshelf 8000 Hz, every band
 *    clamped -12..+12 dB, default 0 (frontend/lib/audioEqualizer.ts:27-47).
 *
 * Pure on purpose: the adapter, the native mixer and CI all read these
 * numbers from one place, and the law is unit-testable without a device.
 */
import type { EqBands, StemGains } from "@/domain/playback";

export const EQ_MIN_DB = -12;
export const EQ_MAX_DB = 12;

export type EqBandName = keyof EqBands;

export interface EqBandSpec {
  band: EqBandName;
  /** Web Audio BiquadFilterNode type; the native mixers map onto these. */
  type: "lowshelf" | "peaking" | "highshelf";
  frequency: number;
  /** Only the peaking band pins a Q on the web; the shelves use the default. */
  q: number | null;
}

/** In series low -> mid -> high, exactly as the web builds the chain. */
export const EQ_BAND_SPECS: readonly EqBandSpec[] = [
  { band: "low", type: "lowshelf", frequency: 120, q: null },
  { band: "mid", type: "peaking", frequency: 1000, q: 1 },
  { band: "high", type: "highshelf", frequency: 8000, q: null },
];

/**
 * NaN would propagate through every gain node and silence (or blow up) the
 * whole graph, so it collapses to the SAFE value for that knob rather than to
 * a bound. Infinities clamp normally.
 */
const clampTo = (v: number, lo: number, hi: number, whenNaN: number): number =>
  Number.isNaN(v) ? whenNaN : Math.min(hi, Math.max(lo, v));

/** 0..1 volume clamp; NaN reads as silence. */
export const clampUnit = (v: number): number => clampTo(v, 0, 1, 0);

/** -12..+12 dB clamp; NaN reads as flat. */
export const clampEqDb = (db: number): number => clampTo(db, EQ_MIN_DB, EQ_MAX_DB, 0);

export const clampEqBands = (bands: EqBands): EqBands => ({
  low: clampEqDb(bands.low),
  mid: clampEqDb(bands.mid),
  high: clampEqDb(bands.high),
});

export const clampStemGains = (gains: StemGains): StemGains => ({
  vocal: clampUnit(gains.vocal),
  instrumental: clampUnit(gains.instrumental),
});

/**
 * True when every band sits at 0 dB, so the mixer may bypass the filters
 * entirely (FR-70 "flat EQ has zero audio-path overhead").
 */
export const eqIsFlat = (bands: EqBands): boolean =>
  clampEqDb(bands.low) === 0 && clampEqDb(bands.mid) === 0 && clampEqDb(bands.high) === 0;

export interface GainLawInput {
  /** The device's own output volume, 0..1 (never adopted from the cable). */
  masterVolume: number;
  /** True while the mixer, not the original file, produces the audio. */
  stemsActive: boolean;
  vocalVolume: number;
  instrumentalVolume: number;
}

export interface GainLawOutput {
  /**
   * Volume of the player holding the ORIGINAL file. Zero while the stems are
   * active: that player stays loaded as the clock and the owner of the lock
   * screen / media session, but is silent.
   */
  mainGain: number;
  /** The mixer's output gain (1 while the mixer is idle). */
  master: number;
  vocal: number;
  instrumental: number;
}

export const gainLaw = (input: GainLawInput): GainLawOutput => {
  const masterVolume = clampUnit(input.masterVolume);
  const vocal = clampUnit(input.vocalVolume);
  const instrumental = clampUnit(input.instrumentalVolume);
  if (!input.stemsActive) {
    return { mainGain: masterVolume, master: 1, vocal, instrumental };
  }
  return { mainGain: 0, master: masterVolume, vocal, instrumental };
};
