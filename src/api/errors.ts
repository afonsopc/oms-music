/**
 * Leitura defensiva dos corpos de erro (FR-5). O servidor responde quase
 * sempre com uma string JSON nua ("Song not found"), às vezes com um array de
 * mensagens de validação, e só o rate limiting tem corpo estruturado:
 * `{ error: "rate_limited", retry_after }`. O proxy de erros (`omsProxy.ts`)
 * usa isto para construir o `ApiError` a partir do `OmsApiError` do SDK.
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
