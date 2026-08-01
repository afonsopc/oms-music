/** Shared API error type and list modifier shapes (DESIGN.md section 4). */

export class ApiError extends Error {
  status: number;
  retryAfter?: number;
  body?: unknown;

  constructor(status: number, message: string, opts?: { retryAfter?: number; body?: unknown }) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.retryAfter = opts?.retryAfter;
    this.body = opts?.body;
  }
}

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError;

export interface ListModifiers {
  page?: `${number}:${number}`;
  order?: string;
  random?: boolean;
}

export interface ListFilters {
  search?: Record<string, unknown>;
  exact_search?: Record<string, unknown>;
  modifiers?: ListModifiers;
  [key: string]: unknown;
}
