/**
 * A letra para o visualizador: as linhas com início e fim e, quando o
 * servidor as tem, as palavras com o seu tempo. Com a tradução ligada no
 * leitor (a mesma escolha), as linhas traduzidas, só por linha. Sem letra
 * sincronizada: null (a camada não aparece).
 */
import { useMemo } from "react";
import { useLyrics, useLyricsTranslation } from "@/api/queries/lyrics";
import type { SongId } from "@/domain/ids";
import { initialTranslationTarget, translationWasOn } from "@/features/lyrics/targetStore";
import { parseLrc } from "@/lyrics/lrc";
import { translationApplies } from "@/lyrics/translation";
import type { VizLyricLine } from "../../../viz/protocol";

const fromLrc = (synced: string | null | undefined): VizLyricLine[] | null => {
  if (!synced) return null;
  const parsed = parseLrc(synced).filter((l) => l.text.trim() !== "");
  if (parsed.length === 0) return null;
  return parsed.map((l, i) => ({
    t: l.time,
    end: i + 1 < parsed.length ? Math.min(parsed[i + 1].time, l.time + 8) : l.time + 5,
    text: l.text,
  }));
};

export const useVizLyrics = (songId: string | null): VizLyricLine[] | null => {
  const id = songId as unknown as SongId | null;
  const lyrics = useLyrics(id, songId != null);
  const target = initialTranslationTarget();
  // Já cantada nessa língua: a letra original (com as palavras), sem pedir tradução.
  const translate = translationWasOn() && translationApplies(lyrics.data?.language, target);
  const translation = useLyricsTranslation(id, target, translate && songId != null && lyrics.isSuccess);
  return useMemo(() => {
    if (translate && !translation.data?.same_language && translation.data?.synced) return fromLrc(translation.data.synced);
    const data = lyrics.data;
    if (!data) return null;
    const byLine = fromLrc(data.synced);
    if (data.words && data.words.length) {
      return data.words
        .filter((l) => l.w.length > 0)
        .map((l, i, all) => {
          const last = l.w[l.w.length - 1];
          const next = all[i + 1]?.t ?? last[1] + 2;
          const line = { t: l.t, end: Math.min(next, last[1] + 1.2), text: l.w.map((w) => w[2]).join(" ") };
          // Sem confiança nas palavras: a linha acende inteira no seu tempo.
          return l.low ? { ...line, whole: true } : { ...line, words: l.w };
        });
    }
    return byLine;
  }, [translate, translation.data, lyrics.data]);
};
