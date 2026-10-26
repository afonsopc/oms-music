import { describe, expect, it } from "bun:test";
import { ApiError } from "@/domain/api";
import {
  authErrorMessage,
  classifyAdoptError,
  isNetworkFailure,
  serverDetail,
  AUTH_ERROR_KEYS,
} from "../authErrors";

/** Mirrors buildApiError: the message is derived, the body kept verbatim. */
const api = (status: number, body?: unknown, retryAfter?: number): ApiError =>
  new ApiError(status, typeof body === "string" ? body : `Request failed (${status})`, {
    body,
    retryAfter,
  });

const codes = (info: { code: string }): string => info.code;

describe("classifyAdoptError (POST /sessions/adopt)", () => {
  it("explains an expired 2 minute ticket instead of saying sign-in failed", () => {
    expect(codes(classifyAdoptError(api(401, "Invalid or expired ticket.")))).toBe("ticketExpired");
  });

  it("still reports rate limits and outages", () => {
    expect(codes(classifyAdoptError(api(429, undefined, 12)))).toBe("rateLimited");
    expect(codes(classifyAdoptError(api(503)))).toBe("serverError");
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
    const info = classifyAdoptError(api(429, undefined, 20));
    expect(authErrorMessage(info, translate)).toBe(
      'native.common.rateLimited:{"seconds":20}',
    );
  });

  it("prefers the server's own sentence when there is one", () => {
    const info = classifyAdoptError(api(422, "Ticket is malformed"));
    expect(authErrorMessage(info, translate)).toBe("Ticket is malformed");
  });

  it("has a key for every code", () => {
    for (const key of Object.values(AUTH_ERROR_KEYS)) {
      expect(key.startsWith("native.")).toBe(true);
    }
  });
});
