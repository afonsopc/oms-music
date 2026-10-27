import { describe, expect, it } from "bun:test";
import {
  isOtpShape,
  otpAttemptsLeft,
  otpIssued,
  otpMsLeft,
  otpState,
  otpWrongGuess,
  OTP_LENGTH,
  OTP_MAX_ATTEMPTS,
  OTP_TTL_MS,
  OTP_UNSENT,
} from "../otp";

const T0 = 1_800_000_000_000;

describe("the code contract mirrors EmailVerification", () => {
  it("pins the three server constants", () => {
    expect(OTP_LENGTH).toBe(6);
    expect(OTP_TTL_MS).toBe(15 * 60 * 1000);
    expect(OTP_MAX_ATTEMPTS).toBe(5);
  });

  it("accepts exactly six digits", () => {
    expect(isOtpShape("012345")).toBe(true);
    expect(isOtpShape("  012345  ")).toBe(true);
    expect(isOtpShape("12345")).toBe(false);
    expect(isOtpShape("1234567")).toBe(false);
    expect(isOtpShape("12345a")).toBe(false);
    expect(isOtpShape("")).toBe(false);
  });
});

describe("otpState", () => {
  it("is unsent before the first send", () => {
    expect(otpState(OTP_UNSENT, T0)).toBe("unsent");
    expect(otpMsLeft(OTP_UNSENT, T0)).toBe(0);
  });

  it("is live inside the 15 minute window", () => {
    const budget = otpIssued(T0);
    expect(otpState(budget, T0)).toBe("live");
    expect(otpState(budget, T0 + OTP_TTL_MS - 1)).toBe("live");
    expect(otpMsLeft(budget, T0 + 60_000)).toBe(OTP_TTL_MS - 60_000);
  });

  it("expires exactly at the TTL", () => {
    const budget = otpIssued(T0);
    expect(otpState(budget, T0 + OTP_TTL_MS)).toBe("expired");
    expect(otpMsLeft(budget, T0 + OTP_TTL_MS + 1)).toBe(0);
  });

  it("burns on the fifth wrong guess, matching the server destroying the row", () => {
    let budget = otpIssued(T0);
    for (let i = 1; i < OTP_MAX_ATTEMPTS; i++) {
      budget = otpWrongGuess(budget);
      expect(otpState(budget, T0)).toBe("live");
      expect(otpAttemptsLeft(budget)).toBe(OTP_MAX_ATTEMPTS - i);
    }
    budget = otpWrongGuess(budget);
    expect(otpState(budget, T0)).toBe("burned");
    expect(otpAttemptsLeft(budget)).toBe(0);
  });

  it("stays burned rather than reporting expiry once the budget is spent", () => {
    let budget = otpIssued(T0);
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) budget = otpWrongGuess(budget);
    expect(otpState(budget, T0 + OTP_TTL_MS * 10)).toBe("burned");
  });

  it("never charges past the budget", () => {
    let budget = otpIssued(T0);
    for (let i = 0; i < 20; i++) budget = otpWrongGuess(budget);
    expect(budget.wrongAttempts).toBe(OTP_MAX_ATTEMPTS);
    expect(otpAttemptsLeft(budget)).toBe(0);
  });

  it("resets on a fresh send, because issuing deletes the previous row", () => {
    const spent = otpWrongGuess(otpWrongGuess(otpIssued(T0)));
    expect(spent.wrongAttempts).toBe(2);
    const reissued = otpIssued(T0 + OTP_TTL_MS * 2);
    expect(reissued.wrongAttempts).toBe(0);
    expect(otpState(reissued, T0 + OTP_TTL_MS * 2)).toBe("live");
  });

  it("does not mutate the budget it is given", () => {
    const budget = otpIssued(T0);
    const next = otpWrongGuess(budget);
    expect(budget.wrongAttempts).toBe(0);
    expect(next.wrongAttempts).toBe(1);
    expect(next.issuedAt).toBe(T0);
  });
});
