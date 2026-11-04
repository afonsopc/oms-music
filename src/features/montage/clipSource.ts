/**
 * iOS e Android: a Montagem só usa os clipes que já estão na biblioteca.
 * Nada aqui vai buscar vídeos (ver clipSource.web.ts e docs/app-store.md).
 */
import type { Locale } from "@/i18n";
import type { MontageStyle } from "../../../montage/protocol";

export const canFetchClips = false;

export interface ClipFetch {
  id: number;
  state: "pending" | "running" | "done" | "failed";
  step: "library" | "searching" | "downloading" | null;
  wanted: number;
  cached: number;
  planned: number;
  downloaded: number;
  failed: number;
  clip_ids: number[];
  themes: string[];
  error: string | null;
}

export interface ClipBudget {
  downloads_left_today: number;
  searches_left_today: number;
  per_montage_downloads: number;
  paused_until: string | null;
}

const none = (): never => {
  throw new Error("not available");
};

export const startClipFetch = (_body: { song_id: number | string; input: string; style: MontageStyle; seed: number }): Promise<{ item: ClipFetch; budget: ClipBudget }> =>
  Promise.resolve().then(none);

export const getClipFetch = (_id: number): Promise<{ item: ClipFetch; budget: ClipBudget }> => Promise.resolve().then(none);

const same = {
  placeholder: "",
  searching: "",
  downloading: () => "",
  paused: "",
  noneToday: "",
};
export const FETCH_COPY: Record<Locale, { placeholder: string; searching: string; downloading: (n: number, of: number) => string; paused: string; noneToday: string }> = {
  pt: { ...same, placeholder: "Um tema da tua biblioteca (ou nada, para todos)" },
  en: { ...same, placeholder: "A theme from your library (or nothing, for all)" },
  lv: { ...same, placeholder: "Tēma no tavas bibliotēkas (vai nekas, visiem)" },
};
