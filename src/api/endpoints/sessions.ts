/** Sessions REST (API.md section 2). Login/logout live in auth/session.ts. */
import { request } from "../client";
import type { ListFilters } from "@/domain/api";
import type { Session } from "@/domain/user";

export const getMySession = (): Promise<Session> => request("GET", "/sessions/mine");

export const listSessions = (filters?: ListFilters): Promise<Session[]> =>
  request("GET", "/sessions", { params: filters });

/** Rename the CURRENT device (FR-14). name 1..50, description 1..255. */
export const updateSession = (
  id: string,
  patch: { name?: string; description?: string; device_type?: string },
): Promise<Session> => request("PATCH", `/sessions/${encodeURIComponent(id)}`, { body: patch });
