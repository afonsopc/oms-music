/** Letting go of a pulled sheet: a flick decides, else a third of its height. */
export const SHEET_DISMISS_VELOCITY = 700;

export function shouldDismissSheet(translation: number, velocity: number, height: number): boolean {
  "worklet";
  if (translation <= 0) return false;
  if (velocity > SHEET_DISMISS_VELOCITY) return true;
  if (velocity < -SHEET_DISMISS_VELOCITY) return false;
  return translation > Math.min(160, Math.max(60, height / 3));
}
