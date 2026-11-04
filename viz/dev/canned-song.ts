/** A música de mentira posta no motor (galeria e testes): capa, análise, letra, paleta. */
import type { Engine } from "../main";
import { cannedAnalysis, cannedLyrics, testArtwork } from "../lib/canned";
import { paletteFromImage } from "../lib/palette";

export const CANNED_ID = "canned";

/** Põe a música de teste a tocar a partir de `position` (s). Resolve quando a capa está carregada. */
export const loadCanned = async (e: Engine, position = 0, playing = true) => {
  const art = testArtwork();
  const img = new Image();
  img.src = art;
  await img.decode();
  e.handle({ type: "analysis", songId: CANNED_ID, data: cannedAnalysis() });
  e.handle({ type: "lyrics", songId: CANNED_ID, lines: cannedLyrics() });
  e.handle({ type: "palette", colors: paletteFromImage(img) });
  e.handle({ type: "state", song: { id: CANNED_ID, title: "Canção de Teste", artist: "OMS", artworkUrl: art, tags: ["electronic"], bpm: 128 }, playing, position, at: Date.now() });
  for (let i = 0; i < 100 && !e.env.cover; i++) await new Promise((r) => setTimeout(r, 20));
};
