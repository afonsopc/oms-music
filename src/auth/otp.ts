/**
 * The emailed verification code, mirrored from the server model so the client
 * can tell the user the truth instead of "something went wrong".
 *
 * Backend contract (backend/app/models/email_verification.rb):
 *   CODE_LENGTH  = 6      six numeric digits, zero padded (:6, :65-67)
 *   EXPIRES_IN   = 15.min issued with expires_at (:3, :35-36)
 *   MAX_ATTEMPTS = 5      the FIFTH wrong guess DESTROYS the row (:11, :71-82)
 * and issuing a new code deletes any previous one for the same (reason, email)
 * (:31), so there is never more than one live code per flow.
 *
 * The sharp edge this module exists for: `*_end` answers 404 "Invalid
 * Verification" for a wrong code, an expired code AND a burned code alike
 * (users_controller.rb:116, :134) - the server never says which. The client
 * therefore keeps its own budget, charged in lockstep with the server's, and
 * uses it to pick the honest explanation.
 *
 * Pure and dependency-free on purpose: it is unit tested without a device.
 */

/** EmailVerification::CODE_LENGTH. */
export const OTP_LENGTH = 6;
/** EmailVerification::EXPIRES_IN. */
export const OTP_TTL_MS = 15 * 60 * 1000;
/** EmailVerification::MAX_ATTEMPTS. */
export const OTP_MAX_ATTEMPTS = 5;

const OTP_PATTERN = /^\d{6}$/;

/** True when the string could be a code at all (saves a burned attempt). */
export const isOtpShape = (code: string): boolean => OTP_PATTERN.test(code.trim());

export interface OtpBudget {
  /** Date.now() when the code was requested; null before the first send. */
  issuedAt: number | null;
  /** Wrong guesses already charged against the live code, server side. */
  wrongAttempts: number;
}

export const OTP_UNSENT: OtpBudget = { issuedAt: null, wrongAttempts: 0 };

/** A fresh send resets the budget: the server deleted the previous row. */
export const otpIssued = (now: number): OtpBudget => ({ issuedAt: now, wrongAttempts: 0 });

/** One rejected `*_end` call = one attempt burned server side. */
export const otpWrongGuess = (budget: OtpBudget): OtpBudget => ({
  issuedAt: budget.issuedAt,
  wrongAttempts: Math.min(budget.wrongAttempts + 1, OTP_MAX_ATTEMPTS),
});

export const otpAttemptsLeft = (budget: OtpBudget): number =>
  Math.max(0, OTP_MAX_ATTEMPTS - budget.wrongAttempts);

export type OtpState = "unsent" | "live" | "expired" | "burned";

/**
 * Burned beats expired: once the attempt budget is spent the row is gone,
 * whatever the clock says. Expiry uses the client clock, so it is a hint for
 * the message, never a reason to skip the request.
 */
export const otpState = (budget: OtpBudget, now: number): OtpState => {
  if (budget.issuedAt === null) return "unsent";
  if (budget.wrongAttempts >= OTP_MAX_ATTEMPTS) return "burned";
  if (now - budget.issuedAt >= OTP_TTL_MS) return "expired";
  return "live";
};

/** Milliseconds of life left, floored at 0. */
export const otpMsLeft = (budget: OtpBudget, now: number): number => {
  if (budget.issuedAt === null) return 0;
  return Math.max(0, budget.issuedAt + OTP_TTL_MS - now);
};
