/** "O Melhor DJ": guião + voz do backend (POST /music_dj). */
import { request } from "../client";
import type { SongId } from "@/domain/ids";

export interface DjInterstitial {
  text: string;
  audio_base64: string;
  format: string;
}

/** A geração (LLM + Kokoro no Mini) demora uns segundos; timeout generoso. */
export const fetchDjInterstitial = (
  nextSongId: SongId,
  previousSongId?: SongId | null,
): Promise<DjInterstitial> =>
  request<DjInterstitial>("POST", "/music_dj", {
    body: {
      next_song_id: nextSongId,
      ...(previousSongId != null ? { previous_song_id: previousSongId } : {}),
    },
    timeoutMs: 120_000,
  });
