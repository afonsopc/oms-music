/**
 * A Montagem no núcleo da música: a biblioteca de clipes de cada um e a
 * montagem guardada de cada música (GET /montage_clips, GET/PUT
 * /songs/:id/montage). Igual em todas as plataformas: só lê e guarda.
 */
import { oms } from "@/api/oms";
import type { MontageClip, MontageStyle } from "../../../montage/protocol";

export interface SavedMontage {
  song_id: number;
  seed: number;
  style: MontageStyle;
  themes: string[];
  clip_ids: number[];
}

export interface MontageAnswer {
  montage: SavedMontage | null;
  clips: MontageClip[];
}

export const getSongMontage = (songId: string | number): Promise<MontageAnswer> =>
  oms().http.get<MontageAnswer>(`/songs/${encodeURIComponent(String(songId))}/montage`);

export const saveSongMontage = (
  songId: string | number,
  body: { seed: number; style: MontageStyle; themes: string[]; clip_ids: number[] },
): Promise<MontageAnswer> =>
  oms().http.put<MontageAnswer>(`/songs/${encodeURIComponent(String(songId))}/montage`, body, { retry: false });

export const listClips = (tags: string[] = [], limit = 120): Promise<MontageClip[]> =>
  oms()
    .http.get<{ items: MontageClip[] }>("/montage_clips", { query: { tags, limit } })
    .then((r) => r.items);

export const montageQueryKey = (songId: string | number | null) => ["montage", "song", songId == null ? "none" : String(songId)];
