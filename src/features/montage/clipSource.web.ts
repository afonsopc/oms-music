/**
 * Web e computador: a Montagem pode ir buscar clipes novos ao serviço de
 * importação (POST/GET /clip_fetches). SÓ neste ficheiro .web.ts: o Metro não
 * o leva para iOS nem Android, e os textos que falam de ir buscar vídeos ficam
 * aqui, fora dos catálogos. Ver docs/app-store.md.
 */
import { oms } from "@/api/oms";
import type { Locale } from "@/i18n";
import type { MontageStyle } from "../../../montage/protocol";

export const canFetchClips = true;

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

export const startClipFetch = (body: { song_id: number | string; input: string; style: MontageStyle; seed: number }) =>
  oms().http.post<{ item: ClipFetch; budget: ClipBudget }>("/clip_fetches", body, { retry: false });

export const getClipFetch = (id: number) => oms().http.get<{ item: ClipFetch; budget: ClipBudget }>(`/clip_fetches/${id}`);

export const FETCH_COPY: Record<Locale, { placeholder: string; searching: string; downloading: (n: number, of: number) => string; paused: string; noneToday: string }> = {
  pt: {
    placeholder: "anime luta, Evangelion, cenas de filmes anos 80… ou cola links do YouTube",
    searching: "A procurar clipes…",
    downloading: (n, of) => `A descarregar ${n} de ${of}…`,
    paused: "O YouTube pediu uma pausa. Por agora, só os clipes que já tens.",
    noneToday: "Por hoje já não há clipes novos. Usei os que tens.",
  },
  en: {
    placeholder: "anime fight, Evangelion, 80s film scenes… or paste YouTube links",
    searching: "Looking for clips…",
    downloading: (n, of) => `Downloading ${n} of ${of}…`,
    paused: "YouTube asked for a break. For now, only the clips you have.",
    noneToday: "No more new clips today. Used the ones you have.",
  },
  lv: {
    placeholder: "anime cīņa, Evangelion, 80. gadu filmu ainas… vai ielīmē YouTube saites",
    searching: "Meklē klipus…",
    downloading: (n, of) => `Lejupielādē ${n} no ${of}…`,
    paused: "YouTube lūdza pauzi. Pagaidām tikai tavi klipi.",
    noneToday: "Šodien jaunu klipu vairs nav. Izmantoju tavējos.",
  },
};
