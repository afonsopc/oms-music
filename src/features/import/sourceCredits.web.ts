/**
 * Web e desktop: as linhas de créditos de onde a importação foi buscar as
 * letras, a semelhança das rádios e a biografia dos artistas. SÓ neste
 * ficheiro .web.ts (com os textos aqui dentro, fora dos catálogos partilhados
 * que vão para as apps nativas): o par nativo, `sourceCredits.ts`, não mostra
 * nada. Ver docs/app-store.md.
 */
import { getLocale, type Locale } from "@/i18n";

export type SourceCreditKind = "lyrics" | "radio" | "artistAbout";

const COPY: Record<Locale, { lyrics: string; radio: string; artistAbout: string }> = {
  pt: { lyrics: "Letras via {source}", radio: "Similaridade via Last.fm", artistAbout: "Bio via Last.fm / Wikipedia (CC-BY-SA)." },
  en: { lyrics: "Lyrics via {source}", radio: "Similarity via Last.fm", artistAbout: "Bio via Last.fm / Wikipedia (CC-BY-SA)." },
  lv: { lyrics: "Vārdi no {source}", radio: "Līdzība no Last.fm", artistAbout: "Biogrāfija no Last.fm / Wikipedia (CC-BY-SA)." },
};

export const sourceCredit = (kind: SourceCreditKind, source?: string | null): string | null => {
  const copy = COPY[getLocale()] ?? COPY.pt;
  if (kind === "lyrics") return source ? copy.lyrics.replace("{source}", source) : null;
  return copy[kind];
};
