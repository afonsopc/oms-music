/**
 * Denunciar, bloquear e os Termos (App Store 1.2). O backend da música confere
 * o que a pessoa pode ver e passa ao omelhorsite (a mesma fila de denúncias,
 * o mesmo bloqueio e os mesmos Termos do site):
 *
 *   POST /music/reports { kind, id, reason, details }
 *   POST /music/blocks  { user_id }
 *   GET  /music/terms?lang= -> { accepted, version, url }
 *   POST /music/terms
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { oms } from "@/api/oms";
import { keys } from "@/api/queryKeys";
import { useAuthReady } from "@/auth/guard";
import { getLocale } from "@/i18n";

export type ReportKind = "user" | "jam" | "playlist" | "song";
export const REPORT_REASONS = [
  "spam",
  "harassment",
  "hate",
  "sexual",
  "violence",
  "self_harm",
  "illegal",
  "impersonation",
  "other",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export interface ReportTarget {
  kind: ReportKind;
  id: string | number;
  /** O nome que aparece no título da folha (pessoa, jam, playlist, música). */
  label?: string;
}

export const reportContent = (target: ReportTarget, reason: ReportReason, details: string): Promise<unknown> =>
  oms().http.post("/music/reports", {
    kind: target.kind,
    id: String(target.id),
    reason,
    details: details.trim() || undefined,
  });

export const blockUser = (userId: string): Promise<unknown> =>
  oms().http.post("/music/blocks", { user_id: userId });

/** Depois de bloquear: amizades, perfis, jams e o feed de amigos mudam. */
export const useAfterBlock = () => {
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: keys.relationships }),
      client.invalidateQueries({ queryKey: keys.jams }),
      client.invalidateQueries({ queryKey: ["musicProfile"] }),
    ]);
};

export interface TermsState {
  accepted: boolean;
  version: string | null;
  url: string;
}

export const termsKey = ["musicTerms"] as const;

export const useTerms = () => {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: termsKey,
    queryFn: () => oms().http.get<TermsState>("/music/terms", { query: { lang: getLocale() } }),
    enabled: authReady,
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });
};

export const acceptTerms = (): Promise<unknown> => oms().http.post("/music/terms", {});

/** As páginas do site com a política, os termos e o contacto (pt, en; lv lê en). */
export const sitePage = (page: "privacy-policy" | "terms-of-service" | "about-us"): string => {
  const lang = getLocale() === "pt" ? "pt" : "en";
  return `https://omelhorsite.pt/${lang}/${page}`;
};

export const ACCOUNT_DELETE_URL = "https://id.omelhorsite.pt/ui/v2/login/account#delete";
