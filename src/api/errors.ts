/**
 * Defensive error-body parsing (FR-5). Bodies are usually bare JSON strings
 * ("Song not found"), occasionally arrays of validation messages, and only
 * rate limiting has a structured body: { error: "rate_limited", retry_after }.
 */
import { ApiError } from "@/domain/api";

export { ApiError };

export const parseErrorMessage = (body: unknown, fallback: string): string => {
  if (typeof body === "string" && body.trim()) return body;
  if (Array.isArray(body)) {
    const parts = body.filter((p): p is string => typeof p === "string");
    if (parts.length) return parts.join("\n");
  }
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if (typeof record.error === "string") return record.error;
    if (typeof record.message === "string") return record.message;
  }
  return fallback;
};

export const parseRetryAfter = (
  body: unknown,
  headerValue: string | null,
): number | undefined => {
  if (body && typeof body === "object") {
    const retryAfter = (body as Record<string, unknown>).retry_after;
    if (typeof retryAfter === "number" && Number.isFinite(retryAfter)) return retryAfter;
  }
  if (headerValue) {
    const parsed = Number(headerValue);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

export const buildApiError = (
  status: number,
  body: unknown,
  retryAfterHeader: string | null,
): ApiError => {
  const message = parseErrorMessage(body, `Request failed (${status})`);
  const retryAfter = status === 429 ? parseRetryAfter(body, retryAfterHeader) : undefined;
  return new ApiError(status, message, { retryAfter, body });
};
