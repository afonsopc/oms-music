import { describe, expect, it } from "bun:test";
import { ApiError } from "@/domain/api";
import {
  authErrorMessage,
  classifyAdoptError,
  classifyCodeRequestError,
  classifyCodeSubmitError,
  classifyLoginError,
  isNetworkFailure,
  serverDetail,
  AUTH_ERROR_KEYS,
  MissingCredentialsError,
} from "../authErrors";
import { otpIssued, otpWrongGuess, OTP_MAX_ATTEMPTS, OTP_TTL_MS, OTP_UNSENT } from "../otp";

const T0 = 1_800_000_000_000;

/** Mirrors buildApiError: the message is derived, the body kept verbatim. */
const api = (status: number, body?: unknown, retryAfter?: number): ApiError =>
  new ApiError(status, typeof body === "string" ? body : `Request failed (${status})`, {
    body,
    retryAfter,
  });

const codes = (info: { code: string }): string => info.code;

describe("classifyLoginError (POST /sessions)", () => {
  it("calls a 401 what it is", () => {
    expect(codes(classifyLoginError(api(401, "Invalid email address or password.")))).toBe(
      "invalidCredentials",
    );
  });

  it("explains the 422 a deactivated account produces, which has an EMPTY body", () => {
    // sessions.create! trips user_not_deactivated -> RecordInvalid -> Rails'
    // ShowExceptions -> PublicExceptions finds no public/422.html and passes
    // through, so only the status code survives.
    expect(codes(classifyLoginError(api(422, undefined)))).toBe("accountDeactivated");
  });

  it("refuses locally rather than letting a body without a password key 500", () => {
    expect(codes(classifyLoginError(new MissingCredentialsError()))).toBe("missingPassword");
  });

  it("carries the retry countdown out of a 429", () => {
    const info = classifyLoginError(api(429, { error: "rate_limited", retry_after: 37 }, 37));
    expect(info.code).toBe("rateLimited");
    expect(info.params.seconds).toBe(37);
  });

  it("defaults the countdown when the server sends no retry_after", () => {
    expect(classifyLoginError(api(429)).params.seconds).toBe(60);
  });

  it("recognises a dropped connection, which is not an ApiError", () => {
    const networkError = new TypeError("Network request failed");
    expect(codes(classifyLoginError(networkError))).toBe("offline");
    const aborted = new Error("Aborted");
    aborted.name = "AbortError";
    expect(codes(classifyLoginError(aborted))).toBe("offline");
    expect(codes(classifyLoginError(api(0, "Not authenticated")))).toBe("offline");
  });

  it("falls back to unknown for anything unmapped", () => {
    expect(codes(classifyLoginError(api(418)))).toBe("unknown");
    expect(codes(classifyLoginError("boom"))).toBe("unknown");
    expect(codes(classifyLoginError(null))).toBe("unknown");
  });
});

describe("classifyLoginError never blames the user for a server fault", () => {
  it("keeps every 5xx as serverError, including the missing-key 500", () => {
    for (const status of [500, 502, 503, 504]) {
      expect(codes(classifyLoginError(api(status)))).toBe("serverError");
    }
  });
});

describe("classifyAdoptError (POST /sessions/adopt)", () => {
  it("explains an expired 2 minute ticket instead of saying sign-in failed", () => {
    expect(codes(classifyAdoptError(api(401, "Invalid or expired ticket.")))).toBe("ticketExpired");
  });

  it("still reports rate limits and outages", () => {
    expect(codes(classifyAdoptError(api(429, undefined, 12)))).toBe("rateLimited");
    expect(codes(classifyAdoptError(api(503)))).toBe("serverError");
  });
});

describe("classifyCodeRequestError (POST /users/*_start)", () => {
  it("maps the signup 409 to the taken-email copy", () => {
    expect(codes(classifyCodeRequestError(api(409, "Email already registered.")))).toBe(
      "emailTaken",
    );
  });

  it("feeds the resend cooldown from a 429", () => {
    const info = classifyCodeRequestError(api(429, undefined, 45));
    expect(info.code).toBe("rateLimited");
    expect(info.params.seconds).toBe(45);
  });

  it("shows the server's own validation sentence for a 422", () => {
    const info = classifyCodeRequestError(api(422, "Email is invalid"));
    expect(info.detail).toBe("Email is invalid");
  });
});

describe("classifyCodeSubmitError (POST /users/*_end)", () => {
  const wrongOnce = otpWrongGuess(otpIssued(T0));

  it("says wrong code, with the attempts the server has left", () => {
    const info = classifyCodeSubmitError(api(404, "Invalid Verification"), wrongOnce, T0);
    expect(info.code).toBe("codeInvalid");
    expect(info.params.attempts).toBe(OTP_MAX_ATTEMPTS - 1);
  });

  it("says expired once the 15 minutes are gone, from the same 404", () => {
    const budget = otpWrongGuess(otpIssued(T0));
    const info = classifyCodeSubmitError(
      api(404, "Invalid Verification"),
      budget,
      T0 + OTP_TTL_MS + 1,
    );
    expect(info.code).toBe("codeExpired");
  });

  it("says burned once the fifth attempt is spent, from the same 404", () => {
    let budget = otpIssued(T0);
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) budget = otpWrongGuess(budget);
    expect(codes(classifyCodeSubmitError(api(404, "Invalid Verification"), budget, T0))).toBe(
      "codeBurned",
    );
  });

  it("separates the reset flow's other 404, which is not the code's fault", () => {
    expect(codes(classifyCodeSubmitError(api(404, "User not found."), wrongOnce, T0))).toBe(
      "accountNotFound",
    );
  });

  it("shows the account validation sentence a 422 carries", () => {
    const info = classifyCodeSubmitError(
      api(422, "Password is too short (minimum is 8 characters)"),
      wrongOnce,
      T0,
    );
    expect(info.detail).toBe("Password is too short (minimum is 8 characters)");
  });

  it("still reports rate limits before touching the budget", () => {
    expect(codes(classifyCodeSubmitError(api(429, undefined, 9), OTP_UNSENT, T0))).toBe(
      "rateLimited",
    );
  });
});

describe("serverDetail", () => {
  it("passes a short bare string through", () => {
    expect(serverDetail(api(422, "Handle is too long"))).toBe("Handle is too long");
  });

  it("refuses object bodies, empty strings and essays", () => {
    expect(serverDetail(api(429, { error: "rate_limited" }))).toBeUndefined();
    expect(serverDetail(api(422, "   "))).toBeUndefined();
    expect(serverDetail(api(500, "x".repeat(500)))).toBeUndefined();
    expect(serverDetail(new Error("nope"))).toBeUndefined();
  });
});

describe("isNetworkFailure", () => {
  it("covers the shapes fetch really throws", () => {
    expect(isNetworkFailure(new TypeError("Network request failed"))).toBe(true);
    expect(isNetworkFailure(new Error("Failed to fetch"))).toBe(true);
    expect(isNetworkFailure(new Error("request timed out"))).toBe(true);
    expect(isNetworkFailure(api(0, "Not authenticated"))).toBe(true);
  });

  it("does not mistake a real HTTP answer for an outage", () => {
    expect(isNetworkFailure(api(401))).toBe(false);
    expect(isNetworkFailure(api(500))).toBe(false);
    expect(isNetworkFailure("offline")).toBe(false);
  });
});

describe("authErrorMessage", () => {
  const translate = (key: string, params?: Record<string, string | number>): string =>
    `${key}${params && Object.keys(params).length ? `:${JSON.stringify(params)}` : ""}`;

  it("renders through the catalog key and passes the ICU params", () => {
    const info = classifyLoginError(api(429, undefined, 20));
    expect(authErrorMessage(info, translate)).toBe(
      'native.common.rateLimited:{"seconds":20}',
    );
  });

  it("prefers the server's own sentence when there is one", () => {
    const info = classifyCodeRequestError(api(422, "Email is invalid"));
    expect(authErrorMessage(info, translate)).toBe("Email is invalid");
  });

  it("has a key for every code", () => {
    for (const key of Object.values(AUTH_ERROR_KEYS)) {
      expect(key.startsWith("native.")).toBe(true);
    }
  });
});
