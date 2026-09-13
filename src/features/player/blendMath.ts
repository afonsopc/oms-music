/**
 * Pure slider math for the cog's blend and EQ rows (FR-69 / FR-70).
 *
 * The two ranges the web pins are transcribed here so the native sliders
 * quantize to exactly the same steps: blend volumes 0..1 step 0.01 (web
 * CogDropdown 411-431) and EQ bands -12..+12 dB step 0.5 (web EqBand 112-116,
 * bounds from player/gainLaw). <Slider/> speaks 0..1 track fractions only, so
 * every mapping between a fraction and a real unit lives in this one testable
 * place instead of being retyped per row.
 */
import { EQ_MAX_DB, EQ_MIN_DB } from "@/player/gainLaw";

/** UI step of the two blend sliders. */
export const BLEND_STEP = 0.01;
/** UI step of the three EQ bands, in dB. */
export const EQ_STEP_DB = 0.5;

const EQ_SPAN_DB = EQ_MAX_DB - EQ_MIN_DB;

/** NaN reads as 0 so a broken gesture can never write NaN into a gain. */
const clamp01 = (value: number): number =>
  Number.isNaN(value) ? 0 : value < 0 ? 0 : value > 1 ? 1 : value;

/** Track fraction -> blend volume, snapped to the 0.01 step. */
export const quantizeBlend = (fraction: number): number =>
  Math.round(clamp01(fraction) / BLEND_STEP) * BLEND_STEP;

/** Readout for a blend slider ("0.75"). */
export const formatBlend = (value: number): string => clamp01(value).toFixed(2);

/** Track fraction -> band gain in dB, snapped to the 0.5 dB step. */
export const dbFromFraction = (fraction: number): number =>
  Math.round((EQ_MIN_DB + clamp01(fraction) * EQ_SPAN_DB) / EQ_STEP_DB) * EQ_STEP_DB;

/** Band gain in dB -> track fraction (the engine already clamped the value). */
export const fractionFromDb = (db: number): number =>
  clamp01((db - EQ_MIN_DB) / EQ_SPAN_DB);

/** Readout for an EQ band ("+3.0 dB", "0.0 dB", "-1.5 dB"). */
export const formatDb = (db: number): string => `${db > 0 ? "+" : ""}${db.toFixed(1)} dB`;

// ---------------------------------------------------------------------------
// Playback rate (0.5x .. 1.5x), for the speed track that sits under the preset
// chips. Snapped to 0.01, the two decimals the readout already shows (owner,
// 2026-09-13): the coarser step jumped straight over the value the ear was
// hunting for, and every preset chip is still a multiple of the step.
// ---------------------------------------------------------------------------

export const RATE_MIN = 0.5;
export const RATE_MAX = 1.5;
/** UI step of the speed track, in playback-rate units. */
export const RATE_STEP = 0.01;

/** Steps per rate unit (100 at a 0.01 step): an integer divisor, on purpose. */
const RATE_STEPS_PER_UNIT = Math.round(1 / RATE_STEP);

/**
 * Track fraction -> playback rate, snapped by MULTIPLYING into whole steps and
 * dividing back. The obvious `Math.round(x / 0.01) * 0.01` returns
 * 1.2100000000000002 a third of the way along the track, and that dust is what
 * gets written into the store, persisted as a 19-character string and sent down
 * the wire - the readout says 1.21x, the value is not one.
 */
export const fractionToRate = (fraction: number): number =>
  Math.round((RATE_MIN + clamp01(fraction) * (RATE_MAX - RATE_MIN)) * RATE_STEPS_PER_UNIT) /
  RATE_STEPS_PER_UNIT;

/** Playback rate -> track fraction. */
export const rateToFraction = (rate: number): number =>
  clamp01((rate - RATE_MIN) / (RATE_MAX - RATE_MIN));
